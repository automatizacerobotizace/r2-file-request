import { describe, expect, it } from "vitest";
import { MemoryMailer } from "../src/mailer";
import { buildMessage, smtpSend, type SocketLike, type SmtpOptions } from "../src/smtp";

const opts: SmtpOptions = {
  host: "smtp.example.com", port: 587, user: "u@example.com", password: "p",
  from: "fileshare@example.com", fromName: "Example",
};

// Scripted fake server: each client write is answered by the reply for its command.
// `closed` records which socket ("plain" or "tls") had close() called.
function fakeServer(replies: Record<string, string>, log: string[], closed: string[] = []): SocketLike {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const make = (tls: boolean, greet: boolean): SocketLike => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
        if (greet) c.enqueue(enc.encode("220 smtp.example.com ESMTP\r\n"));
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        const text = dec.decode(chunk);
        const cmd = text.endsWith("\r\n.\r\n") ? "<DATA>" : text.trim().split(" ")[0]!.toUpperCase();
        log.push((tls ? "tls:" : "") + (cmd === "<DATA>" ? cmd : text.trim()));
        const reply = replies[cmd];
        if (reply) ctrl.enqueue(enc.encode(reply));
      },
    });
    return {
      readable,
      writable,
      startTls: () => make(true, false),
      close: async () => {
        closed.push(tls ? "tls" : "plain");
      },
    };
  };
  return make(false, true);
}

const okReplies = {
  EHLO: "250-smtp.example.com\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n",
  STARTTLS: "220 ready\r\n",
  AUTH: "235 ok\r\n",
  MAIL: "250 ok\r\n",
  RCPT: "250 ok\r\n",
  DATA: "354 go\r\n",
  "<DATA>": "250 queued\r\n",
  QUIT: "221 bye\r\n",
};

describe("smtpSend", () => {
  it("runs EHLO, STARTTLS, AUTH PLAIN, MAIL, RCPT, DATA, QUIT", async () => {
    const log: string[] = [];
    await smtpSend(fakeServer(okReplies, log), opts, { to: "c@example.org", subject: "S", text: "T" }, new Date(0));
    expect(log).toEqual([
      "EHLO example.com",
      "STARTTLS",
      "tls:EHLO example.com",
      "tls:AUTH PLAIN " + btoa("\0u@example.com\0p"),
      "tls:MAIL FROM:<fileshare@example.com>",
      "tls:RCPT TO:<c@example.org>",
      "tls:DATA",
      "tls:<DATA>",
      "tls:QUIT",
    ]);
  });

  it("throws on authentication failure", async () => {
    const log: string[] = [];
    const replies = { ...okReplies, AUTH: "535 5.7.8 bad credentials\r\n" };
    await expect(
      smtpSend(fakeServer(replies, log), opts, { to: "c@example.org", subject: "S", text: "T" }, new Date(0)),
    ).rejects.toThrow(/535/);
  });

  it("refuses recipients with line breaks", async () => {
    await expect(
      smtpSend(fakeServer(okReplies, []), opts, { to: "a@b.c\r\nRCPT TO:<x@y.z>", subject: "S", text: "T" }, new Date(0)),
    ).rejects.toThrow(/recipient/);
  });

  it("times out when the server stops answering and closes the active socket", async () => {
    const log: string[] = [];
    const closed: string[] = [];
    // The server answers EHLO and STARTTLS, then the TLS EHLO, and goes silent at AUTH.
    const { AUTH: _silent, ...replies } = okReplies;
    await expect(
      smtpSend(fakeServer(replies, log, closed), opts, { to: "c@example.org", subject: "S", text: "T" }, new Date(0), 50),
    ).rejects.toThrow("smtp: timeout");
    expect(log.at(-1)).toMatch(/^tls:AUTH PLAIN /);
    expect(closed).toContain("tls");
  });
});

describe("buildMessage", () => {
  it("builds a base64 UTF-8 plain-text message with encoded headers", () => {
    const msg = buildMessage({
      from: "fileshare@example.com", fromName: "Příklad", to: "c@example.org",
      subject: "Odkaz – soubor", text: "Dobrý den\n", date: new Date("2026-09-28T10:00:00Z"),
      messageId: "<id@example.com>",
    });
    const [head, body] = msg.split("\r\n\r\n");
    expect(head).toContain("From: =?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode("Příklad"))) + "?= <fileshare@example.com>");
    expect(head).toContain("To: <c@example.org>");
    expect(head).toContain("Date: Mon, 28 Sep 2026 10:00:00 +0000");
    expect(head).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(head).toContain("Content-Transfer-Encoding: base64");
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(body!.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)));
    expect(decoded).toBe("Dobrý den\r\n");
    for (const line of msg.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });
});

describe("MemoryMailer", () => {
  it("records mail and can fail on demand", async () => {
    const m = new MemoryMailer();
    await m.send({ to: "a@b.c", subject: "s", text: "t" });
    m.failures = 1;
    await expect(m.send({ to: "a@b.c", subject: "s", text: "t" })).rejects.toThrow();
    await m.send({ to: "a@b.c", subject: "s2", text: "t" });
    expect(m.sent.map((x) => x.subject)).toEqual(["s", "s2"]);
  });
});
