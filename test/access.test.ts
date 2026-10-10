import { beforeEach, describe, expect, it } from "vitest";
import { resetJwksCache, verifyAccessJwt } from "../src/access";
import { fakeFetch } from "./fake-fetch";
import { JWKS_URL, T0, jwksBody, signJwt } from "./helpers";

const cfg = { teamDomain: "example.cloudflareaccess.com", aud: "AUD1" };
const s = Math.floor(T0 / 1000);
const claims = { aud: ["AUD1"], iss: "https://example.cloudflareaccess.com", email: "Admin@Example.com", exp: s + 600, iat: s };
const jwksFetch = () => fakeFetch({ [JWKS_URL]: async () => Response.json(await jwksBody()) });

beforeEach(resetJwksCache);

describe("verifyAccessJwt", () => {
  it("accepts a valid token, lowercases the e-mail and caches the keys", async () => {
    const f = jwksFetch();
    expect(await verifyAccessJwt(await signJwt(claims), cfg, f, T0)).toEqual({ email: "admin@example.com" });
    await verifyAccessJwt(await signJwt(claims), cfg, f, T0);
    expect(f.calls).toHaveLength(1);
  });

  it("rejects wrong aud, iss, expired, missing e-mail, foreign key, unknown kid, garbage", async () => {
    const f = jwksFetch();
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
    )) as CryptoKeyPair;
    const bad = [
      await signJwt({ ...claims, aud: ["OTHER"] }),
      await signJwt({ ...claims, iss: "https://evil.cloudflareaccess.com" }),
      await signJwt({ ...claims, exp: s - 120 }),
      await signJwt({ ...claims, email: undefined }),
      await signJwt(claims, { key: other.privateKey }),
      await signJwt(claims, { kid: "unknown" }),
      "a.b.c",
      "",
    ];
    for (const jwt of bad) expect(await verifyAccessJwt(jwt, cfg, f, T0), jwt.slice(0, 20)).toBeNull();
    expect(await verifyAccessJwt(null, cfg, f, T0)).toBeNull();
  });

  it("JWKS failure means no access", async () => {
    const f = fakeFetch({ [JWKS_URL]: () => new Response("", { status: 500 }) });
    expect(await verifyAccessJwt(await signJwt(claims), cfg, f, T0)).toBeNull();
  });
});
