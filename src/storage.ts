import type { Direction } from "./db";
import type { Deps } from "./deps";
import { presignUrl } from "./presign";

export function objectKey(t: { direction: Direction; id: string }): string {
  return `${t.direction}/${t.id}`;
}

// Control characters, line and paragraph separators and bidirectional controls become spaces,
// so a file name always stays on one line and cannot reorder the text around it.
const UNSAFE_NAME_CHARS = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

// Returns the cleaned name, or null when nothing usable is left or it is longer than 255 characters.
export function cleanFileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(UNSAFE_NAME_CHARS, " ").trim();
  return name && name.length <= 255 ? name : null;
}

export async function headObject(bucket: R2Bucket, key: string): Promise<{ size: number; fileName: string | null } | null> {
  const o = await bucket.head(key);
  if (!o) return null;
  const raw = o.customMetadata?.filename;
  let fileName: string | null = null;
  if (raw) {
    try {
      fileName = decodeURIComponent(raw);
    } catch {
      fileName = raw;
    }
  }
  return { size: o.size, fileName };
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key); // deleting a missing key succeeds
}

function seconds(deps: Deps, notAfter: number): number {
  return Math.min(deps.cfg.presignSeconds, Math.floor((notAfter - deps.now()) / 1000));
}

function base(deps: Deps, key: string, secs: number) {
  return {
    endpoint: deps.cfg.s3Endpoint,
    bucket: deps.cfg.bucketName,
    key,
    accessKeyId: deps.env.R2_ACCESS_KEY_ID,
    secretAccessKey: deps.env.R2_SECRET_ACCESS_KEY,
    now: new Date(deps.now()),
    expiresSeconds: secs,
  };
}

// Presigned single PUT: size, no-overwrite and file name are signed.
export async function presignPut(
  deps: Deps, key: string, size: number, name: string, notAfter: number,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const secs = seconds(deps, notAfter);
  if (secs < 1) return null;
  const filename = encodeURIComponent(name);
  const url = await presignUrl({
    ...base(deps, key, secs),
    method: "PUT",
    headers: { "content-length": String(size), "if-none-match": "*", "x-amz-meta-filename": filename },
  });
  return { url, headers: { "If-None-Match": "*", "x-amz-meta-filename": filename } };
}

export async function presignGet(deps: Deps, key: string, fileName: string, notAfter: number): Promise<string | null> {
  const secs = seconds(deps, notAfter);
  if (secs < 1) return null;
  return presignUrl({
    ...base(deps, key, secs),
    method: "GET",
    query: {
      "response-content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "response-content-type": "application/octet-stream",
    },
  });
}
