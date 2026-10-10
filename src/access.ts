interface Jwk extends JsonWebKey {
  kid?: string;
}

const TTL_MS = 3_600_000;
const cache = new Map<string, { at: number; keys: Jwk[] }>();

export function resetJwksCache(): void {
  cache.clear();
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

function decodeJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as T;
}

async function loadKeys(teamDomain: string, fetcher: typeof fetch, now: number, force: boolean): Promise<Jwk[]> {
  const hit = cache.get(teamDomain);
  if (hit && !force && now - hit.at < TTL_MS) return hit.keys;
  const res = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("jwks fetch failed");
  const body = await res.json<{ keys?: Jwk[] }>();
  const keys = body.keys ?? [];
  cache.set(teamDomain, { at: now, keys });
  return keys;
}

export async function verifyAccessJwt(
  jwt: string | null,
  cfg: { teamDomain: string; aud: string },
  fetcher: typeof fetch,
  now: number,
): Promise<{ email: string } | null> {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]!);
    const payload = decodeJson<{ aud?: string | string[]; iss?: string; exp?: number; nbf?: number; email?: string }>(parts[1]!);
    if (header.alg !== "RS256" || !header.kid) return null;
    let jwk = (await loadKeys(cfg.teamDomain, fetcher, now, false)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await loadKeys(cfg.teamDomain, fetcher, now, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const sec = now / 1000;
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(cfg.aud)) return null;
    if (payload.iss !== `https://${cfg.teamDomain}`) return null;
    if (typeof payload.exp !== "number" || payload.exp < sec - 60) return null;
    if (typeof payload.nbf === "number" && payload.nbf > sec + 60) return null;
    if (typeof payload.email !== "string" || !payload.email) return null;
    return { email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}

export function sameOrigin(req: Request, origin: string): boolean {
  return req.headers.get("Origin") === origin;
}
