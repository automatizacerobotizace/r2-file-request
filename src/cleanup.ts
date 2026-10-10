import { DAY_MS, HOUR_MS, addAudit, deleteSetting, getSetting, markPurged, setSetting, type Direction } from "./db";
import type { Deps } from "./deps";
import { notifyProblem } from "./notify";
import { deleteObject, objectKey } from "./storage";

const RETENTION_MS = 90 * DAY_MS;
// An upload that was already running when the transfer ended (expiry or Delete) can still complete afterwards:
// the signed URL is checked only when the PUT starts. Keep deleting the object on every run until one deletion
// has succeeded REDELETE_MS or more after ended_at; only that deletion is final. An upload still running after
// that is left to the R2 lifecycle rule.
const REDELETE_MS = 24 * HOUR_MS;
// One run handles at most CLEANUP_BATCH transfers and marks them with a single UPDATE (D1 allows 100 bound
// parameters per query), so the number of D1 queries per run does not grow with the batch.
export const CLEANUP_BATCH = 90;
const FAILURES_KEY = "cleanup_failures";

// Every step is safe to repeat.
export async function runCleanup(deps: Deps): Promise<{ purged: number; failures: number }> {
  const db = deps.env.DB;
  const now = deps.now();
  await db
    .prepare("UPDATE transfers SET status = 'expired', ended_at = ?1 WHERE status IN ('open', 'received', 'active') AND expires_at <= ?1")
    .bind(now)
    .run();
  await db
    .prepare("UPDATE transfers SET status = 'deleted', ended_at = ?1 WHERE status = 'draft' AND created_at <= ?2")
    .bind(now, now - deps.cfg.draftHours * HOUR_MS)
    .run();

  // Never deleted first, then the least recently deleted: every success moves a transfer to the back.
  const { results } = await db
    .prepare(
      `SELECT id, direction, purged_at FROM transfers
       WHERE status IN ('expired', 'deleted') AND (purged_at IS NULL OR purged_at < ended_at + ?1)
       ORDER BY purged_at
       LIMIT ?2`,
    )
    .bind(REDELETE_MS, CLEANUP_BATCH)
    .all<{ id: string; direction: Direction; purged_at: number | null }>();
  const done: string[] = [];
  let purged = 0;
  let failures = 0;
  for (const r of results) {
    try {
      await deleteObject(deps.env.BUCKET, objectKey(r));
      done.push(r.id);
      if (r.purged_at === null) purged++;
    } catch {
      failures++;
    }
  }
  if (done.length > 0) await markPurged(db, done, now);

  const cutoff = now - RETENTION_MS;
  const ended = "status IN ('expired', 'deleted') AND ended_at <= ?1 AND purged_at >= ended_at + ?2";
  await db.batch([
    db.prepare(`DELETE FROM audit WHERE transfer_id IN (SELECT id FROM transfers WHERE ${ended})`).bind(cutoff, REDELETE_MS),
    db.prepare(`DELETE FROM transfers WHERE ${ended}`).bind(cutoff, REDELETE_MS),
    db.prepare("DELETE FROM audit WHERE transfer_id IS NULL AND ts <= ?").bind(cutoff),
  ]);

  if (failures > 0) {
    await addAudit(db, { ts: now, actor: "system", action: "cleanup_error", detail: `${failures} objects` });
    const runs = Number((await getSetting(db, FAILURES_KEY)) ?? "0") + 1;
    await setSetting(db, FAILURES_KEY, String(runs));
    if (runs >= 3) await notifyProblem(deps, "cleanup", `${runs} runs in a row failed to delete objects`);
  } else {
    await deleteSetting(db, FAILURES_KEY);
  }
  return { purged, failures };
}
