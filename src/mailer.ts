export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(m: Mail): Promise<void>;
}

// Test double: records sent mail; fails the next `failures` sends, or all when failAlways.
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  failures = 0;
  failAlways = false;

  async send(m: Mail): Promise<void> {
    if (this.failAlways || this.failures > 0) {
      if (this.failures > 0) this.failures--;
      throw new Error("memory mailer: simulated failure");
    }
    this.sent.push(m);
  }
}
