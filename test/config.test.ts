import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ConfigError, isValidAdminPath, loadConfig } from "../src/config";

describe("isValidAdminPath", () => {
  it("accepts simple paths", () => {
    for (const p of ["/admin", "/x-7", "/a/b_c"]) expect(isValidAdminPath(p)).toBe(true);
  });
  it("rejects bad or colliding paths", () => {
    for (const p of ["", "/", "admin", "/admin/", "//a", "/a//b", "/a b", "/u", "/u/x", "/d", "/api", "/api/x", "/static", "/static/a", "/brand", "/brand/x"]) {
      expect(isValidAdminPath(p), p).toBe(false);
    }
  });
});

describe("loadConfig", () => {
  it("reads defaults and variables", () => {
    const cfg = loadConfig(env);
    expect(cfg.origin).toBe("https://fileshare.example.com");
    expect(cfg.host).toBe("fileshare.example.com");
    expect(cfg.maxFileSize).toBe(3_000_000_000);
    expect(cfg.formLimitPerEmail).toBe(3);
    expect(cfg.formLimitTotal).toBe(20);
    expect(cfg.uploadLimitTotal).toBe(20);
    expect(cfg.downloadLimitTotal).toBe(20);
    expect(cfg.downloadLimitPerLink).toBe(5);
    expect(cfg.linkDaysMax).toBe(7);
    expect(cfg.presignSeconds).toBe(120);
    expect(cfg.draftHours).toBe(24);
    expect(cfg.defaultLang).toBe("en");
    expect(cfg.notifyFirstDownload).toBe(true);
  });

  it("uses code defaults when optional variables are missing", () => {
    const cfg = loadConfig({ ...env, MAX_FILE_BYTES: undefined, LINK_DAYS: undefined });
    expect(cfg.maxFileSize).toBe(3_000_000_000);
    expect(cfg.linkDaysMax).toBe(7);
  });

  it("reads brand settings with footer language fallback", () => {
    const cfg = loadConfig({ ...env, BRAND_CSS: "/brand/t.css", BRAND_LOGO: "/brand/logo.webp", BRAND_FOOTER_HTML_CS: "<p>A</p>" });
    expect(cfg.brandCss).toBe("/brand/t.css");
    expect(cfg.brandLogo).toBe("/brand/logo.webp");
    expect(cfg.brandFooterHtml).toEqual({ cs: "<p>A</p>", en: "<p>A</p>" });
    expect(loadConfig(env).brandFooterHtml).toEqual({ cs: "", en: "" });
  });

  it("throws on invalid ADMIN_PATH, origin or numbers", () => {
    expect(() => loadConfig({ ...env, ADMIN_PATH: "/api" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, ADMIN_PATH: "/brand" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, PUBLIC_ORIGIN: "http://x.example.com" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, PUBLIC_ORIGIN: "https://x.example.com/" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, DAILY_REQUESTS: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, LINK_DAYS: "8" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, BRAND_CSS: "https://evil.example/x.css" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, BRAND_LOGO: "/brand/../x.png" })).toThrow(ConfigError);
  });
});
