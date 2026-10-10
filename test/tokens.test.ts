import { describe, expect, it } from "vitest";
import { base64url, hashToken, isTokenShape, newId, newToken, sha256Hex } from "../src/tokens";

describe("tokens", () => {
  it("newToken has 256 bits as 43 base64url characters", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isTokenShape(t)).toBe(true);
    expect(newToken()).not.toBe(t);
  });

  it("isTokenShape rejects other strings", () => {
    expect(isTokenShape("abc")).toBe(false);
    expect(isTokenShape("a".repeat(42) + "=")).toBe(false);
    expect(isTokenShape("a".repeat(44))).toBe(false);
  });

  it("hashToken is SHA-256 hex", async () => {
    expect(await hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("base64url has no padding or +/", () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe("-_-_");
  });

  it("newId is a UUID v4", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
