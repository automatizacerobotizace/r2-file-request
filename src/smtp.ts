import { connect } from "cloudflare:sockets";
import type { Mail, Mailer } from "./mailer";

export interface SmtpOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  fromName: string;
}

export interface SocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  startTls(): SocketLike;
  close(): Promise<void>;
}

const TIMEOUT_MS = 20_000;

function b64utf8(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function encodeWord(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64utf8(s)}?=`;
}

export function buildMessage(o: {
  from: string; fromName: string; to: string; subject: string; text: string; date: Date; messageId: string;
}): string {
  const body = b64utf8(o.text.replace(/\r?\n/g, "\r\n")).replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${encodeWord(o.fromName)} <${o.from}>`,
    `To: <${o.to}>`,
    `Subject: ${encodeWord(o.subject)}`,
    `Date: ${o.date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: ${o.messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

class Conn {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buf = "";
  private dec = new TextDecoder();
  private enc = new TextEncoder();

  constructor(readonly socket: SocketLike) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  release(): void {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) {
        const l = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        return l;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new Error("smtp: connection closed");
      this.buf += this.dec.decode(value, { stream: true });
    }
  }

  async expect(code: number): Promise<void> {
    for (;;) {
      const l = await this.line();
      if (l.length < 4 || l[3] === "-") continue; // multi-line reply continues
      if (!l.startsWith(String(code))) throw new Error(`smtp: expected ${code}, got ${l.slice(0, 3)}`);
      return;
    }
  }

  async write(s: string): Promise<void> {
    await this.writer.write(this.enc.encode(s));
  }

  async cmd(s: string, code: number): Promise<void> {
    await this.write(s + "\r\n");
    await this.expect(code);
  }
}

// Rejects with "smtp: timeout" after `ms` and calls onTimeout; the timer is always cleared.
async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("smtp: timeout"));
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function smtpSend(
  socket: SocketLike, o: SmtpOptions, m: Mail, now: Date, timeoutMs = TIMEOUT_MS,
): Promise<void> {
  if (/[\r\n<>\s]/.test(m.to) || !m.to.includes("@")) throw new Error("smtp: invalid recipient");
  const helo = o.from.split("@")[1] ?? "localhost";
  let active = socket; // the socket in use; replaced by the TLS socket after STARTTLS
  const run = async () => {
    let c = new Conn(socket);
    try {
      await c.expect(220);
      await c.cmd(`EHLO ${helo}`, 250);
      await c.cmd("STARTTLS", 220);
      c.release();
      active = socket.startTls();
      c = new Conn(active);
      await c.cmd(`EHLO ${helo}`, 250);
      await c.cmd(`AUTH PLAIN ${b64utf8(`\0${o.user}\0${o.password}`)}`, 235);
      await c.cmd(`MAIL FROM:<${o.from}>`, 250);
      await c.cmd(`RCPT TO:<${m.to}>`, 250);
      await c.cmd("DATA", 354);
      const msg = buildMessage({
        from: o.from, fromName: o.fromName, to: m.to, subject: m.subject, text: m.text,
        date: now, messageId: `<${crypto.randomUUID()}@${helo}>`,
      });
      await c.write(msg + ".\r\n"); // msg already ends with CRLF
      await c.expect(250);
      await c.cmd("QUIT", 221).catch(() => undefined);
    } finally {
      await c.socket.close().catch(() => undefined);
    }
  };
  await withTimeout(run(), timeoutMs, () => void active.close().catch(() => undefined));
}

export class SmtpMailer implements Mailer {
  constructor(private readonly o: SmtpOptions) {}

  async send(m: Mail): Promise<void> {
    const socket = connect(
      { hostname: this.o.host, port: this.o.port },
      { secureTransport: "starttls", allowHalfOpen: false },
    );
    await smtpSend(socket as unknown as SocketLike, this.o, m, new Date());
  }
}
