import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { e1UploadLink, e2NewRequest, e3FileReceived, e4DownloadLink, e5FirstDownload, e6Problem } from "../src/emails";

const cfg = loadConfig({ ...env, ORG_NAME: "Example", TIME_ZONE: "Europe/Prague", DEFAULT_LANG: "cs" });
const exp = Date.UTC(2026, 9, 5, 12, 30);

describe("emails", () => {
  it("E1 has the expected Czech text and an English variant", () => {
    const m = e1UploadLink(cfg, { to: "c@example.org", lang: "cs", url: "https://fileshare.example.com/u/TOKEN", expiresAt: exp });
    expect(m.to).toBe("c@example.org");
    expect(m.subject).toBe("Odkaz pro odeslání souboru – Example");
    expect(m.text).toContain("https://fileshare.example.com/u/TOKEN");
    expect(m.text).toContain("Odkaz platí do 5. 10. 2026 14:30.");
    expect(m.text).toContain("nejvýše 3 GB");
    expect(m.text).toContain("ZIP nebo tar.gz");
    expect(m.text).toContain("7-Zip (AES-256)");
    expect(m.text).toContain("Pokud jste o odkaz nežádali, tento e-mail ignorujte.");
    const en = e1UploadLink(cfg, { to: "c@example.org", lang: "en", url: "u", expiresAt: exp });
    expect(en.subject).toBe("Link to send a file – Example");
    expect(en.text).toContain("2026-10-05 14:30");
  });

  it("E2/E3/E5/E6 go to the admin address in the default language", () => {
    const e2 = e2NewRequest(cfg, { requester: "c@example.org", createdAt: exp, expiresAt: exp });
    expect(e2.to).toBe(cfg.adminEmail);
    expect(e2.text).toContain("c@example.org");
    const e3 = e3FileReceived(cfg, { requester: "c@example.org", fileName: "a.zip", fileSize: 1_500_000_000, adminUrl: "https://x/admin" });
    expect(e3.text).toContain("a.zip");
    expect(e3.text).toContain("1,5 GB");
    expect(e3.text).toContain("https://x/admin");
    const e5 = e5FirstDownload(cfg, { recipient: "c@example.org", sentAt: exp, clickedAt: exp, adminUrl: "https://x/admin" });
    expect(e5.to).toBe(cfg.adminEmail);
    expect(e5.text).toContain("c@example.org");
    const e6 = e6Problem(cfg, { kind: "dns", detail: "example.org", at: exp });
    expect(e6.subject).toContain("DNS");
    expect(e6.text).toContain("example.org");
  });

  it("E4 contains link, validity, name, size and the password sentence", () => {
    const m = e4DownloadLink(cfg, {
      to: "c@example.org", lang: "cs", url: "https://fileshare.example.com/d/TOKEN", expiresAt: exp,
      fileName: "výkres.pdf", fileSize: 3_000_000_000,
    });
    expect(m.text).toContain("https://fileshare.example.com/d/TOKEN");
    expect(m.text).toContain("5. 10. 2026 14:30");
    expect(m.text).toContain("výkres.pdf");
    expect(m.text).toContain("3 GB");
    expect(m.text).toContain("Pokud je soubor zašifrovaný, heslo vám sdělíme jinou cestou.");
  });
});
