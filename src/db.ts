import type { Lang } from "./config";

export type Direction = "in" | "out";
export type Status = "open" | "received" | "draft" | "active" | "expired" | "deleted";
export type Origin = "form" | "admin";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface Transfer {
  id: string;
  direction: Direction;
  token_hash: string | null;
  email: string;
  lang: Lang;
  origin: Origin;
  created_at: number;
  sent_at: number | null;
  link_version: number;
  valid_days: number;
  expires_at: number | null;
  status: Status;
  file_name: string | null;
  file_size: number | null;
  uploaded_at: number | null;
  first_download_at: number | null;
  purged_at: number | null;
  ended_at: number | null;
}

export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  transferId?: string | null;
  linkVersion?: number | null;
  detail?: string | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  actor: string;
  action: string;
  transfer_id: string | null;
  link_version: number | null;
  detail: string | null;
}

export function isLive(t: Transfer, now: number): boolean {
  return t.expires_at !== null && t.expires_at > now;
}

async function changed(stmt: D1PreparedStatement): Promise<boolean> {
  const r = await stmt.run();
  return r.meta.changes === 1;
}

export function getTransfer(db: D1Database, id: string): Promise<Transfer | null> {
  return db.prepare("SELECT * FROM transfers WHERE id = ?").bind(id).first<Transfer>();
}

export function getByTokenHash(db: D1Database, hash: string): Promise<Transfer | null> {
  return db.prepare("SELECT * FROM transfers WHERE token_hash = ?").bind(hash).first<Transfer>();
}

export async function addAudit(db: D1Database, e: AuditEntry): Promise<void> {
  await db
    .prepare("INSERT INTO audit (ts, actor, action, transfer_id, link_version, detail) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(e.ts, e.actor, e.action, e.transferId ?? null, e.linkVersion ?? null, e.detail ?? null)
    .run();
}

export async function insertAdminIncoming(
  db: D1Database,
  p: { id: string; tokenHash: string; email: string; lang: Lang; validDays: number; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transfers (id, direction, token_hash, email, lang, origin, created_at, sent_at, link_version, valid_days, expires_at, status)
       VALUES (?1, 'in', ?2, ?3, ?4, 'admin', ?5, ?5, 1, ?6, ?7, 'open')`,
    )
    .bind(p.id, p.tokenHash, p.email, p.lang, p.now, p.validDays, p.now + p.validDays * DAY_MS)
    .run();
}

export async function insertDraft(
  db: D1Database,
  p: { id: string; email: string; lang: Lang; validDays: number; now: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transfers (id, direction, token_hash, email, lang, origin, created_at, sent_at, link_version, valid_days, expires_at, status)
       VALUES (?1, 'out', NULL, ?2, ?3, 'admin', ?4, NULL, 0, ?5, NULL, 'draft')`,
    )
    .bind(p.id, p.email, p.lang, p.now, p.validDays)
    .run();
}

export function markReceived(db: D1Database, id: string, name: string, size: number, now: number): Promise<boolean> {
  return changed(
    db
      .prepare(
        `UPDATE transfers SET status = 'received', file_name = ?2, file_size = ?3, uploaded_at = ?4
         WHERE id = ?1 AND direction = 'in' AND status = 'open' AND expires_at > ?4`,
      )
      .bind(id, name, size, now),
  );
}

export function markOutUploaded(
  db: D1Database, id: string, name: string, size: number, now: number, createdAfter: number,
): Promise<boolean> {
  return changed(
    db
      .prepare(
        `UPDATE transfers SET file_name = ?2, file_size = ?3, uploaded_at = ?4
         WHERE id = ?1 AND direction = 'out' AND status = 'draft' AND uploaded_at IS NULL AND created_at > ?5`,
      )
      .bind(id, name, size, now, createdAfter),
  );
}

export function activateOut(
  db: D1Database, id: string, tokenHash: string, now: number, createdAfter: number,
): Promise<boolean> {
  return changed(
    db
      .prepare(
        `UPDATE transfers SET status = 'active', token_hash = ?2, link_version = 1, sent_at = ?3,
                expires_at = ?3 + valid_days * ${DAY_MS}
         WHERE id = ?1 AND status = 'draft' AND uploaded_at IS NOT NULL AND token_hash IS NULL AND created_at > ?4`,
      )
      .bind(id, tokenHash, now, createdAfter),
  );
}

export function rotateToken(db: D1Database, id: string, tokenHash: string, now: number, expectedVersion: number): Promise<boolean> {
  return changed(
    db
      .prepare(
        `UPDATE transfers SET token_hash = ?2, link_version = link_version + 1, sent_at = ?3
         WHERE id = ?1 AND link_version = ?4 AND expires_at > ?3
           AND ((direction = 'out' AND status = 'active') OR (direction = 'in' AND status = 'open' AND origin = 'admin'))`,
      )
      .bind(id, tokenHash, now, expectedVersion),
  );
}

export function markDeleted(db: D1Database, id: string, now: number): Promise<boolean> {
  return changed(
    db
      .prepare(
        "UPDATE transfers SET status = 'deleted', ended_at = ?2 WHERE id = ?1 AND status IN ('open', 'received', 'draft', 'active')",
      )
      .bind(id, now),
  );
}

export async function markPurged(db: D1Database, ids: string[], now: number): Promise<void> {
  const marks = ids.map((_, i) => `?${i + 2}`).join(", ");
  await db.prepare(`UPDATE transfers SET purged_at = ?1 WHERE id IN (${marks})`).bind(now, ...ids).run();
}

export function markFirstDownload(db: D1Database, id: string, now: number): Promise<boolean> {
  return changed(
    db.prepare("UPDATE transfers SET first_download_at = ?2 WHERE id = ?1 AND first_download_at IS NULL").bind(id, now),
  );
}

export async function listTransfers(db: D1Database, direction: Direction): Promise<(Transfer & { downloads: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM audit a
                    WHERE a.transfer_id = t.id AND a.action = 'download_url' AND a.actor = 'customer') AS downloads
       FROM transfers t WHERE t.direction = ? ORDER BY t.created_at DESC LIMIT 200`,
    )
    .bind(direction)
    .all<Transfer & { downloads: number }>();
  return results;
}

export async function recentAudit(db: D1Database, limit: number): Promise<AuditRow[]> {
  const { results } = await db.prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?").bind(limit).all<AuditRow>();
  return results;
}

export async function recentWarnings(db: D1Database, since: number): Promise<AuditRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM audit WHERE action IN ('mail_failed', 'dns_error', 'cleanup_error') AND ts > ?
       ORDER BY id DESC LIMIT 50`,
    )
    .bind(since)
    .all<AuditRow>();
  return results;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, value).run();
}

export function insertSettingIfAbsent(db: D1Database, key: string, value: string): Promise<boolean> {
  return changed(db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(key, value));
}

// Upsert that takes the key only when it is absent or its stored time (ms) is at most staleBefore.
export function claimSetting(db: D1Database, key: string, now: number, staleBefore: number): Promise<boolean> {
  return changed(
    db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(settings.value AS INTEGER) <= ?3`,
      )
      .bind(key, String(now), staleBefore),
  );
}

export function deleteSetting(db: D1Database, key: string): Promise<boolean> {
  return changed(db.prepare("DELETE FROM settings WHERE key = ?").bind(key));
}
