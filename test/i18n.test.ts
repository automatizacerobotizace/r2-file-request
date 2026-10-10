import { describe, expect, it } from "vitest";
import { STRINGS, fill, formatDate, formatSize, t } from "../src/i18n";

describe("i18n", () => {
  it("cs and en have the same non-empty keys", () => {
    const cs = Object.keys(STRINGS.cs).sort();
    expect(Object.keys(STRINGS.en).sort()).toEqual(cs);
    for (const lang of ["cs", "en"] as const) {
      for (const k of cs) expect(STRINGS[lang][k as keyof typeof STRINGS.cs], `${lang}.${k}`).not.toBe("");
    }
  });

  it("fills placeholders", () => {
    expect(fill("a {x} b {y}", { x: 1, y: "z" })).toBe("a 1 b z");
    expect(t("cs", "up_received", { name: "a.zip" })).toBe("Soubor a.zip byl přijat.");
  });

  it("formats dates in the configured time zone", () => {
    const ms = Date.UTC(2026, 9, 5, 12, 30);
    expect(formatDate(ms, "cs", "Europe/Prague")).toBe("5. 10. 2026 14:30");
    expect(formatDate(ms, "en", "Europe/Prague")).toBe("2026-10-05 14:30");
    expect(formatDate(ms, "en", "UTC")).toBe("2026-10-05 12:30");
  });

  it("formats sizes in decimal units", () => {
    expect(formatSize(3_000_000_000, "cs")).toBe("3 GB");
    expect(formatSize(1_500_000_000, "cs")).toBe("1,5 GB");
    expect(formatSize(1_500_000_000, "en")).toBe("1.5 GB");
    expect(formatSize(123_456, "en")).toBe("123 kB");
    expect(formatSize(999, "en")).toBe("999 B");
  });
});
