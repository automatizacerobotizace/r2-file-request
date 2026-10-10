import { sameOrigin, verifyAccessJwt } from "./access";
import { normalizeEmail } from "./address";
import { asLang, type Config } from "./config";
import {
  DAY_MS, HOUR_MS, activateOut, addAudit, getTransfer, insertAdminIncoming, insertDraft, listTransfers, markDeleted,
  markOutUploaded, recentAudit, recentWarnings, rotateToken, type Transfer,
} from "./db";
import type { Deps } from "./deps";
import { e1UploadLink, e4DownloadLink } from "./emails";
import { BASE_HEADERS, apiError, json, readJson } from "./http";
import { enterMaintenance, getMaintenance, leaveMaintenance } from "./maintenance";
import { adminPage, pageResponse } from "./pages";
import { cleanFileName, deleteObject, headObject, objectKey, presignGet, presignPut } from "./storage";
import { hashToken, newId, newToken } from "./tokens";

export function view(t: Transfer & { downloads?: number }): Omit<Transfer, "token_hash"> & { downloads?: number } {
  const { token_hash: _hidden, ...rest } = t;
  return rest;
}

async function overview(deps: Deps): Promise<Response> {
  const db = deps.env.DB;
  return json({
    maintenance: await getMaintenance(db),
    warnings: await recentWarnings(db, deps.now() - 7 * DAY_MS),
  });
}

async function maintenance(req: Request, deps: Deps, actor: string): Promise<Response> {
  const body = await readJson<{ on?: unknown }>(req);
  if (!body || typeof body.on !== "boolean") return apiError("bad_request", 400);
  if (body.on) await enterMaintenance(deps, "manual", actor);
  else await leaveMaintenance(deps, actor);
  return json({ ok: true });
}

function parseDays(v: unknown, cfg: Config): number | null {
  if (v === undefined) return cfg.linkDaysMax;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= cfg.linkDaysMax ? v : null;
}

// Latest moment a file of this transfer may be read (null = no file or not readable).
function fileDeadline(deps: Deps, t: Transfer): number | null {
  if (t.uploaded_at === null) return null;
  if (t.status === "received" || t.status === "active") return t.expires_at;
  if (t.status === "draft") return t.created_at + deps.cfg.draftHours * HOUR_MS;
  return null;
}

async function sendLinkMail(deps: Deps, actor: string, t: Transfer, token: string): Promise<Response> {
  const { cfg } = deps;
  const now = deps.now();
  const kind = t.direction === "in" ? "E1" : "E4";
  const mail = t.direction === "in"
    ? e1UploadLink(cfg, { to: t.email, lang: t.lang, url: `${cfg.origin}/u/${token}`, expiresAt: t.expires_at! })
    : e4DownloadLink(cfg, {
        to: t.email, lang: t.lang, url: `${cfg.origin}/d/${token}`, expiresAt: t.expires_at!,
        fileName: t.file_name!, fileSize: t.file_size!,
      });
  try {
    await deps.mailer.send(mail);
  } catch {
    await addAudit(deps.env.DB, { ts: now, actor: "system", action: "mail_failed", transferId: t.id, linkVersion: t.link_version, detail: kind });
    return json({ error: "mail_failed", id: t.id, linkVersion: t.link_version }, 502);
  }
  await addAudit(deps.env.DB, { ts: now, actor, action: "link_sent", transferId: t.id, linkVersion: t.link_version, detail: kind });
  return json({ ok: true, id: t.id, linkVersion: t.link_version });
}

async function createIncoming(req: Request, deps: Deps, actor: string): Promise<Response> {
  const db = deps.env.DB;
  const body = await readJson<{ email?: unknown; days?: unknown; lang?: unknown }>(req);
  const email = normalizeEmail(body?.email);
  const days = parseDays(body?.days, deps.cfg);
  if (!email || days === null) return apiError("bad_request", 400);
  const lang = asLang(typeof body?.lang === "string" ? body.lang : null, deps.cfg.defaultLang);
  const id = newId();
  const token = newToken();
  const now = deps.now();
  await insertAdminIncoming(db, { id, tokenHash: await hashToken(token), email, lang, validDays: days, now });
  await addAudit(db, { ts: now, actor, action: "request_created", transferId: id, linkVersion: 1 });
  return sendLinkMail(deps, actor, (await getTransfer(db, id))!, token);
}

async function resend(req: Request, deps: Deps, actor: string, id: string): Promise<Response> {
  const db = deps.env.DB;
  const body = await readJson<{ linkVersion?: unknown }>(req);
  const expected = body?.linkVersion;
  if (typeof expected !== "number" || !Number.isInteger(expected)) return apiError("bad_request", 400);
  const token = newToken();
  const now = deps.now();
  if (!(await rotateToken(db, id, await hashToken(token), now, expected))) {
    const cur = await getTransfer(db, id);
    return json({ error: "conflict", transfer: cur ? view(cur) : null }, 409);
  }
  const t = (await getTransfer(db, id))!;
  await addAudit(db, { ts: now, actor, action: "link_rotated", transferId: id, linkVersion: t.link_version });
  return sendLinkMail(deps, actor, t, token);
}

async function remove(deps: Deps, actor: string, id: string): Promise<Response> {
  const db = deps.env.DB;
  const t = await getTransfer(db, id);
  if (!t) return apiError("not_found", 404);
  const now = deps.now();
  if (await markDeleted(db, id, now)) {
    await addAudit(db, { ts: now, actor, action: "deleted", transferId: id });
    try {
      await deleteObject(deps.env.BUCKET, objectKey(t));
    } catch {
      // the cleanup job retries
    }
    // purged_at is set by the cleanup job, which keeps deleting the object until a deletion succeeds 24 h after ended_at (see cleanup.ts).
  }
  return json({ ok: true, status: (await getTransfer(db, id))?.status });
}

async function adminDownload(deps: Deps, actor: string, id: string): Promise<Response> {
  const t = await getTransfer(deps.env.DB, id);
  if (!t) return apiError("not_found", 404);
  const deadline = fileDeadline(deps, t);
  const url = deadline !== null && t.file_name ? await presignGet(deps, objectKey(t), t.file_name, deadline) : null;
  if (!url) return apiError("link_invalid", 410);
  await addAudit(deps.env.DB, { ts: deps.now(), actor, action: "admin_download", transferId: id });
  return json({ url });
}

async function createDraft(req: Request, deps: Deps, actor: string): Promise<Response> {
  const db = deps.env.DB;
  const body = await readJson<{ email?: unknown; days?: unknown; lang?: unknown; name?: unknown; size?: unknown }>(req);
  const email = normalizeEmail(body?.email);
  const days = parseDays(body?.days, deps.cfg);
  const name = cleanFileName(body?.name);
  const size = body?.size;
  if (!email || days === null || !name || typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    return apiError("bad_request", 400);
  }
  if (size > deps.cfg.maxFileSize) return apiError("too_large", 413);
  const lang = asLang(typeof body?.lang === "string" ? body.lang : null, deps.cfg.defaultLang);
  const id = newId();
  const now = deps.now();
  await insertDraft(db, { id, email, lang, validDays: days, now });
  await addAudit(db, { ts: now, actor, action: "draft_created", transferId: id });
  const put = await presignPut(deps, objectKey({ direction: "out", id }), size, name, now + deps.cfg.draftHours * HOUR_MS);
  if (!put) return apiError("unavailable", 503);
  await addAudit(db, { ts: now, actor, action: "upload_url", transferId: id });
  return json({ id, ...put });
}

async function confirmOut(deps: Deps, actor: string, id: string): Promise<Response> {
  const db = deps.env.DB;
  const t = await getTransfer(db, id);
  const now = deps.now();
  const createdAfter = now - deps.cfg.draftHours * HOUR_MS;
  if (!t || t.direction !== "out" || t.status !== "draft" || t.created_at <= createdAfter) return apiError("link_invalid", 410);
  if (t.uploaded_at !== null) return json({ ok: true });
  const obj = await headObject(deps.env.BUCKET, objectKey(t));
  if (!obj) return apiError("upload_failed", 409);
  if (await markOutUploaded(db, id, obj.fileName ?? "file", obj.size, now, createdAfter)) {
    await addAudit(db, { ts: now, actor, action: "uploaded", transferId: id, detail: String(obj.size) });
  }
  return json({ ok: true });
}

async function sendOut(deps: Deps, actor: string, id: string): Promise<Response> {
  const db = deps.env.DB;
  const now = deps.now();
  const createdAfter = now - deps.cfg.draftHours * HOUR_MS;
  const conflict = (cur: Transfer | null) => json({ error: "conflict", transfer: cur ? view(cur) : null }, 409);
  const before = await getTransfer(db, id);
  if (before && before.status === "draft" && before.created_at <= createdAfter) return conflict(before);
  const token = newToken();
  if (!(await activateOut(db, id, await hashToken(token), now, createdAfter))) return conflict(await getTransfer(db, id));
  const t = (await getTransfer(db, id))!;
  return sendLinkMail(deps, actor, t, token);
}

async function route(req: Request, deps: Deps, actor: string, sub: string): Promise<Response | null> {
  const db = deps.env.DB;
  if (req.method === "GET") {
    if (sub === "/api/overview") return overview(deps);
    if (sub === "/api/audit") return json({ events: await recentAudit(db, 200) });
    if (sub === "/api/transfers") {
      const d = new URL(req.url).searchParams.get("direction");
      if (d !== "in" && d !== "out") return apiError("bad_request", 400);
      return json({ transfers: (await listTransfers(db, d)).map(view) });
    }
    return null;
  }
  if (sub === "/api/maintenance") return maintenance(req, deps, actor);
  if (sub === "/api/in") return createIncoming(req, deps, actor);
  if (sub === "/api/out") return createDraft(req, deps, actor);
  const m = sub.match(/^\/api\/transfers\/([0-9a-f-]{36})\/(confirm|send|resend|delete|download)$/);
  if (!m) return null;
  const id = m[1]!;
  switch (m[2]) {
    case "confirm": return confirmOut(deps, actor, id);
    case "send": return sendOut(deps, actor, id);
    case "resend": return resend(req, deps, actor, id);
    case "delete": return remove(deps, actor, id);
    case "download": return adminDownload(deps, actor, id);
  }
  return null;
}

export async function handleAdmin(req: Request, deps: Deps, sub: string): Promise<Response> {
  const isApi = sub.startsWith("/api/");
  const who = await verifyAccessJwt(
    req.headers.get("Cf-Access-Jwt-Assertion"),
    { teamDomain: deps.cfg.accessTeamDomain, aud: deps.cfg.accessAud },
    deps.fetch,
    deps.now(),
  );
  if (!who) return isApi ? apiError("forbidden", 403) : new Response("Forbidden", { status: 403, headers: BASE_HEADERS });
  if (req.method === "POST") {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!sameOrigin(req, deps.cfg.origin) || !ct.startsWith("application/json")) return apiError("forbidden", 403);
  } else if (req.method !== "GET") {
    return apiError("not_found", 404);
  }
  if (req.method === "GET" && (sub === "" || sub === "/")) return pageResponse(adminPage(deps.cfg));
  return (await route(req, deps, `admin:${who.email}`, sub)) ?? apiError("not_found", 404);
}
