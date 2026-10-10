import { normalizeEmail } from "./address";
import { asLang, type Lang } from "./config";
import { DAY_MS, addAudit, getByTokenHash, getTransfer, isLive, markFirstDownload, markReceived, type Transfer } from "./db";
import type { Deps } from "./deps";
import { e1UploadLink, e2NewRequest, e3FileReceived, e5FirstDownload } from "./emails";
import { apiError, json, readJson, redirect } from "./http";
import { t } from "./i18n";
import { consumeDownload, consumeUpload, createFormTransfer } from "./limits";
import { enterMaintenance, getMaintenance } from "./maintenance";
import { checkMx } from "./mx";
import { notifyProblem, sendNotice } from "./notify";
import { downloadPage, formPage, messagePage, pageResponse, uploadPage } from "./pages";
import { cleanFileName, headObject, objectKey, presignGet, presignPut } from "./storage";
import { hashToken, isTokenShape, newId, newToken } from "./tokens";
import { verifyTurnstile } from "./turnstile";

export async function byToken(deps: Deps, token: string): Promise<Transfer | null> {
  if (!isTokenShape(token)) return null;
  return getByTokenHash(deps.env.DB, await hashToken(token));
}

export function message(deps: Deps, lang: Lang, key: Parameters<typeof t>[1], status: number): Response {
  return pageResponse(messagePage(deps.cfg, lang, t(lang, key, { org: deps.cfg.orgName })), status);
}

async function requestLink(req: Request, deps: Deps): Promise<Response> {
  const { cfg } = deps;
  const db = deps.env.DB;
  // The body is read before any check, so a client cannot hold the request open between a check and its effect.
  const body = await readJson<{ email?: unknown; turnstile?: unknown; lang?: unknown }>(req);
  const now = deps.now();
  if (await getMaintenance(db)) return apiError("maintenance", 503);
  if (!body) return apiError("bad_request", 400);
  const lang = asLang(typeof body.lang === "string" ? body.lang : null, cfg.defaultLang);
  const turnstile = typeof body.turnstile === "string" ? body.turnstile : "";
  if (!(await verifyTurnstile(turnstile, deps.env.TURNSTILE_SECRET, deps.fetch))) return apiError("turnstile_failed", 400);

  const neutral = json({ ok: true });
  const email = normalizeEmail(body.email);
  if (!email) return neutral;
  const domain = email.split("@")[1]!;
  const mx = await checkMx(domain, deps.fetch);
  if (mx === "none") return neutral;
  if (mx === "error") {
    await addAudit(db, { ts: now, actor: "system", action: "dns_error", detail: domain });
    await notifyProblem(deps, "dns", domain);
    return apiError("try_later", 503);
  }

  const id = newId();
  const token = newToken();
  const limit = await createFormTransfer(db, cfg, { id, tokenHash: await hashToken(token), email, lang, now });
  if (limit === "global") {
    await enterMaintenance(deps, "form_total", "system");
    return apiError("maintenance", 503);
  }
  if (limit === "local") return neutral;
  await addAudit(db, { ts: now, actor: "customer", action: "request_created", transferId: id, linkVersion: 1 });

  const expiresAt = now + cfg.linkDaysMax * DAY_MS;
  try {
    await deps.mailer.send(e1UploadLink(cfg, { to: email, lang, url: `${cfg.origin}/u/${token}`, expiresAt }));
  } catch {
    await addAudit(db, { ts: now, actor: "system", action: "mail_failed", transferId: id, detail: "E1" });
    await notifyProblem(deps, "e1_failed", `transfer ${id}`);
    return apiError("try_later", 503);
  }
  await sendNotice(deps, e2NewRequest(cfg, { requester: email, createdAt: now, expiresAt }), "E2", id);
  return neutral;
}

async function uploadPageRoute(deps: Deps, token: string): Promise<Response> {
  const t = await byToken(deps, token);
  const lang = t?.lang ?? deps.cfg.defaultLang;
  if (await getMaintenance(deps.env.DB)) return message(deps, lang, "err_maintenance", 503);
  if (!t || t.direction !== "in") return message(deps, lang, "err_link_invalid", 410);
  if (t.status === "received") return message(deps, lang, "up_already", 200);
  if (t.status !== "open" || !isLive(t, deps.now())) return message(deps, lang, "err_link_invalid", 410);
  return pageResponse(uploadPage(deps.cfg, t.lang, { token, expiresAt: t.expires_at! }));
}

async function startUpload(req: Request, deps: Deps, token: string): Promise<Response> {
  const db = deps.env.DB;
  // The body is read before any check, so a client cannot hold the request open between a check and the URL.
  const body = await readJson<{ name?: unknown; size?: unknown }>(req);
  const now = deps.now();
  if (await getMaintenance(db)) return apiError("maintenance", 503);
  const t = await byToken(deps, token);
  if (!t || t.direction !== "in" || t.status !== "open" || !isLive(t, now)) return apiError("link_invalid", 410);
  const name = cleanFileName(body?.name);
  if (!body || !name || typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 0) {
    return apiError("bad_request", 400);
  }
  if (body.size > deps.cfg.maxFileSize) return apiError("too_large", 413);
  if ((await consumeUpload(db, deps.cfg, t.id, t.link_version, now)) !== "ok") {
    await enterMaintenance(deps, "upload_total", "system");
    return apiError("maintenance", 503);
  }
  const put = await presignPut(deps, objectKey(t), body.size, name, t.expires_at!);
  return put ? json(put) : apiError("link_invalid", 410);
}

async function confirmUpload(deps: Deps, token: string): Promise<Response> {
  const { cfg } = deps;
  const db = deps.env.DB;
  const now = deps.now();
  const t = await byToken(deps, token);
  if (!t || t.direction !== "in") return apiError("link_invalid", 410);
  if (t.status === "received") return json({ ok: true, fileName: t.file_name });
  if (t.status !== "open" || !isLive(t, now)) return apiError("link_invalid", 410);
  const obj = await headObject(deps.env.BUCKET, objectKey(t));
  if (!obj) {
    await addAudit(db, { ts: now, actor: "customer", action: "upload_failed", transferId: t.id, linkVersion: t.link_version });
    return apiError("upload_failed", 409);
  }
  const name = obj.fileName ?? "file";
  if (await markReceived(db, t.id, name, obj.size, now)) {
    await addAudit(db, { ts: now, actor: "customer", action: "received", transferId: t.id, linkVersion: t.link_version, detail: String(obj.size) });
    await sendNotice(deps, e3FileReceived(cfg, {
      requester: t.email, fileName: name, fileSize: obj.size, adminUrl: `${cfg.origin}${cfg.adminPath}`,
    }), "E3", t.id);
    return json({ ok: true, fileName: name });
  }
  const again = await getTransfer(db, t.id);
  return again?.status === "received" ? json({ ok: true, fileName: again.file_name }) : apiError("link_invalid", 410);
}

async function downloadPageRoute(deps: Deps, token: string): Promise<Response> {
  const t = await byToken(deps, token);
  const lang = t?.lang ?? deps.cfg.defaultLang;
  if (await getMaintenance(deps.env.DB)) return message(deps, lang, "err_maintenance", 503);
  if (!t || t.direction !== "out" || t.status !== "active" || !isLive(t, deps.now())) {
    return message(deps, lang, "err_link_invalid", 410);
  }
  return pageResponse(downloadPage(deps.cfg, t.lang, {
    token, fileName: t.file_name!, fileSize: t.file_size!, expiresAt: t.expires_at!,
  }));
}

async function download(deps: Deps, token: string): Promise<Response> {
  const { cfg } = deps;
  const db = deps.env.DB;
  const now = deps.now();
  const t = await byToken(deps, token);
  const lang = t?.lang ?? cfg.defaultLang;
  if (await getMaintenance(db)) return message(deps, lang, "err_maintenance", 503);
  if (!t || t.direction !== "out" || t.status !== "active" || !isLive(t, now)) return message(deps, lang, "err_link_invalid", 410);
  const limit = await consumeDownload(db, cfg, t.id, t.link_version, now);
  if (limit === "global") {
    await enterMaintenance(deps, "download_total", "system");
    return message(deps, lang, "err_maintenance", 503);
  }
  if (limit === "local") return message(deps, lang, "err_download_limit", 429);
  if ((await markFirstDownload(db, t.id, now)) && cfg.notifyFirstDownload) {
    await sendNotice(deps, e5FirstDownload(cfg, {
      recipient: t.email, sentAt: t.sent_at!, clickedAt: now, adminUrl: `${cfg.origin}${cfg.adminPath}`,
    }), "E5", t.id);
  }
  const url = await presignGet(deps, objectKey(t), t.file_name!, t.expires_at!);
  return url ? redirect(url, 303) : message(deps, lang, "err_link_invalid", 410);
}

export async function handlePublic(req: Request, deps: Deps, url: URL): Promise<Response | null> {
  const p = url.pathname;
  const get = req.method === "GET";
  const post = req.method === "POST";
  const lang = asLang(url.searchParams.get("lang"), deps.cfg.defaultLang);
  if (p === "/" && get) {
    if (await getMaintenance(deps.env.DB)) return message(deps, lang, "err_maintenance", 503);
    return pageResponse(formPage(deps.cfg, lang));
  }
  if (p === "/api/request" && post) return requestLink(req, deps);
  let m: RegExpMatchArray | null;
  if (get && (m = p.match(/^\/u\/([^/]+)$/))) return uploadPageRoute(deps, m[1]!);
  if (post && (m = p.match(/^\/api\/u\/([^/]+)\/start$/))) return startUpload(req, deps, m[1]!);
  if (post && (m = p.match(/^\/api\/u\/([^/]+)\/confirm$/))) return confirmUpload(deps, m[1]!);
  if (get && (m = p.match(/^\/d\/([^/]+)$/))) return downloadPageRoute(deps, m[1]!);
  if (post && (m = p.match(/^\/d\/([^/]+)\/download$/))) return download(deps, m[1]!);
  return null;
}
