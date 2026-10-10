import { sha256Hex, toHex } from "./tokens";

export interface PresignInput {
  method: "GET" | "PUT";
  endpoint: string; // e.g. https://<account>.eu.r2.cloudflarestorage.com
  bucket: string; // "" = bucket already in the endpoint host (virtual-hosted style)
  key: string;
  region?: string; // R2: "auto"
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
  expiresSeconds: number;
  headers?: Record<string, string>; // lowercase names; signed in addition to host
  query?: Record<string, string>; // extra signed query parameters
}

export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function amzDateOf(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalUri(i: PresignInput): string {
  const keyPath = i.key.split("/").map(uriEncode).join("/");
  return i.bucket ? `/${uriEncode(i.bucket)}/${keyPath}` : `/${keyPath}`;
}

function signedHeaderNames(i: PresignInput): string[] {
  return ["host", ...Object.keys(i.headers ?? {})].sort();
}

function queryParams(i: PresignInput, amzDate: string): [string, string][] {
  const region = i.region ?? "auto";
  const scope = `${amzDate.slice(0, 8)}/${region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${i.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(i.expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaderNames(i).join(";"),
    ...(i.query ?? {}),
  };
  return Object.entries(params)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function canonicalRequest(i: PresignInput, amzDate: string): string {
  const host = new URL(i.endpoint).host;
  const headers: Record<string, string> = { host, ...(i.headers ?? {}) };
  const names = signedHeaderNames(i);
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join("");
  const query = queryParams(i, amzDate).map(([k, v]) => `${k}=${v}`).join("&");
  return [i.method, canonicalUri(i), query, canonicalHeaders, names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

export async function presignUrl(i: PresignInput): Promise<string> {
  if (!Number.isInteger(i.expiresSeconds) || i.expiresSeconds < 1 || i.expiresSeconds > 604800) {
    throw new Error("expiresSeconds out of range");
  }
  const amzDate = amzDateOf(i.now);
  const date = amzDate.slice(0, 8);
  const region = i.region ?? "auto";
  const cr = canonicalRequest(i, amzDate);
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${date}/${region}/s3/aws4_request`,
    await sha256Hex(cr),
  ].join("\n");
  let key = await hmac(new TextEncoder().encode("AWS4" + i.secretAccessKey), date);
  key = await hmac(key, region);
  key = await hmac(key, "s3");
  key = await hmac(key, "aws4_request");
  const signature = toHex(await hmac(key, stringToSign));
  const query = queryParams(i, amzDate).map(([k, v]) => `${k}=${v}`).join("&");
  return `${i.endpoint.replace(/\/$/, "")}${canonicalUri(i)}?${query}&X-Amz-Signature=${signature}`;
}
