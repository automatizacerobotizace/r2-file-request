import type { Config, Lang } from "./config";
import { DAY_MS, addAudit } from "./db";

export type LimitResult = "ok" | "global" | "local";

async function count(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

async function rejected(db: D1Database, now: number, detail: string, transferId?: string): Promise<void> {
  await addAudit(db, { ts: now, actor: "customer", action: "limit_rejected", transferId, detail });
}

// Creates an incoming form transfer only if both the global and the per-e-mail limit allow it (one statement).
export async function createFormTransfer(
  db: D1Database,
  cfg: Config,
  p: { id: string; tokenHash: string; email: string; lang: Lang; now: number },
): Promise<LimitResult> {
  const since = p.now - DAY_MS;
  const r = await db
    .prepare(
      `INSERT INTO transfers (id, direction, token_hash, email, lang, origin, created_at, sent_at, link_version, valid_days, expires_at, status)
       SELECT ?1, 'in', ?2, ?3, ?4, 'form', ?5, ?5, 1, ?6, ?7, 'open'
       WHERE (SELECT COUNT(*) FROM transfers WHERE origin = 'form' AND created_at > ?8) < ?9
         AND (SELECT COUNT(*) FROM transfers WHERE origin = 'form' AND email = ?3 AND created_at > ?8) < ?10`,
    )
    .bind(p.id, p.tokenHash, p.email, p.lang, p.now, cfg.linkDaysMax, p.now + cfg.linkDaysMax * DAY_MS,
      since, cfg.formLimitTotal, cfg.formLimitPerEmail)
    .run();
  if (r.meta.changes === 1) return "ok";
  const total = await count(db, "SELECT COUNT(*) AS n FROM transfers WHERE origin = 'form' AND created_at > ?", since);
  const which: LimitResult = total >= cfg.formLimitTotal ? "global" : "local";
  await rejected(db, p.now, which === "global" ? "form_total" : "form_email");
  return which;
}

export async function consumeUpload(
  db: D1Database, cfg: Config, transferId: string, linkVersion: number, now: number,
): Promise<LimitResult> {
  const r = await db
    .prepare(
      `INSERT INTO audit (ts, actor, action, transfer_id, link_version, detail)
       SELECT ?1, 'customer', 'upload_url', ?2, ?3, NULL
       WHERE (SELECT COUNT(*) FROM audit WHERE action = 'upload_url' AND actor = 'customer' AND ts > ?4) < ?5`,
    )
    .bind(now, transferId, linkVersion, now - DAY_MS, cfg.uploadLimitTotal)
    .run();
  if (r.meta.changes === 1) return "ok";
  await rejected(db, now, "upload_total", transferId);
  return "global";
}

export async function consumeDownload(
  db: D1Database, cfg: Config, transferId: string, linkVersion: number, now: number,
): Promise<LimitResult> {
  const since = now - DAY_MS;
  const r = await db
    .prepare(
      `INSERT INTO audit (ts, actor, action, transfer_id, link_version, detail)
       SELECT ?1, 'customer', 'download_url', ?2, ?3, NULL
       WHERE (SELECT COUNT(*) FROM audit WHERE action = 'download_url' AND actor = 'customer' AND ts > ?4) < ?5
         AND (SELECT COUNT(*) FROM audit WHERE action = 'download_url' AND actor = 'customer'
                AND transfer_id = ?2 AND link_version = ?3) < ?6`,
    )
    .bind(now, transferId, linkVersion, since, cfg.downloadLimitTotal, cfg.downloadLimitPerLink)
    .run();
  if (r.meta.changes === 1) return "ok";
  const total = await count(
    db, "SELECT COUNT(*) AS n FROM audit WHERE action = 'download_url' AND actor = 'customer' AND ts > ?", since,
  );
  const which: LimitResult = total >= cfg.downloadLimitTotal ? "global" : "local";
  await rejected(db, now, which === "global" ? "download_total" : "download_link", transferId);
  return which;
}
