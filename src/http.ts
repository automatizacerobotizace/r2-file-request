export type ErrorCode =
  | "link_invalid" | "too_large" | "download_limit" | "maintenance" | "upload_failed"
  | "turnstile_failed" | "try_later" | "unavailable" | "bad_request" | "forbidden"
  | "not_found" | "conflict" | "mail_failed";

export const BASE_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export interface CspExtra {
  script?: string[];
  frame?: string[];
  connect?: string[];
  formAction?: string[];
}

export function csp(extra: CspExtra = {}): string {
  const list = (base: string[], more?: string[]) => [...base, ...(more ?? [])].join(" ");
  return [
    "default-src 'none'",
    `script-src ${list(["'self'"], extra.script)}`,
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${list(["'self'"], extra.connect)}`,
    `frame-src ${extra.frame?.length ? extra.frame.join(" ") : "'none'"}`,
    `form-action ${list(["'self'"], extra.formAction)}`,
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function headers(contentType: string | null, cspValue: string): Headers {
  const h = new Headers(BASE_HEADERS);
  if (contentType) h.set("Content-Type", contentType);
  h.set("Content-Security-Policy", cspValue);
  return h;
}

export function html(body: string, cspValue: string, status = 200): Response {
  return new Response(body, { status, headers: headers("text/html; charset=utf-8", cspValue) });
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: headers("application/json", API_CSP) });
}

export function apiError(code: ErrorCode, status: number): Response {
  return json({ error: code }, status);
}

export function redirect(location: string, status = 303): Response {
  const h = headers(null, API_CSP);
  h.set("Location", location);
  return new Response(null, { status, headers: h });
}

// Control messages only (e-mail, Turnstile token, language, file name, days, size).
export const MAX_JSON_BYTES = 16 * 1024;

async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  const announced = req.headers.get("content-length");
  if (announced !== null && Number(announced) > limit) return null;
  if (req.body === null) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  try {
    const bytes = await readLimited(req, MAX_JSON_BYTES);
    if (bytes === null) return null;
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as T) : null;
  } catch {
    return null;
  }
}
