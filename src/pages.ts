import type { Config, Lang } from "./config";
import { csp, html } from "./http";
import { STRINGS, formatDate, formatSize, t, type Key } from "./i18n";

export interface Page {
  body: string;
  csp: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function data(value: unknown): string {
  return `<script type="application/json" id="page-data">${JSON.stringify(value).replace(/</g, "\\u003c")}</script>`;
}

function layout(cfg: Config, lang: Lang, o: { title: string; main: string; scripts?: string[]; data?: unknown; head?: string }): string {
  const scripts = (o.scripts ?? []).map((s) => `<script src="${s}"></script>`).join("");
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(o.title)} – ${esc(cfg.orgName)}</title><link rel="stylesheet" href="/static/style.css">` +
    (cfg.brandCss ? `<link rel="stylesheet" href="${esc(cfg.brandCss)}">` : "") + `${o.head ?? ""}</head><body><header>` +
    (cfg.brandLogo ? `<img class="brand-logo" src="${esc(cfg.brandLogo)}" alt="${esc(cfg.orgName)}">` : "") +
    `<strong>${esc(cfg.orgName)}</strong> · ${esc(t(lang, "app_title"))}</header><main>${o.main}</main>` +
    (o.scripts?.length ? `<noscript><p class="error">${esc(t(lang, "noscript"))}</p></noscript>` : "") +
    // Footer HTML is operator configuration, inserted as is; never customer text.
    (cfg.brandFooterHtml[lang] ? `<footer class="site-footer">${cfg.brandFooterHtml[lang]}</footer>` : "") +
    (o.data !== undefined ? data(o.data) : "") + scripts + `</body></html>`;
}

function texts(lang: Lang, keys: Key[], vars: Record<string, string>): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, t(lang, k, vars)]));
}

const ERR_KEYS: Key[] = [
  "err_link_invalid", "err_too_large", "err_download_limit", "err_maintenance", "err_upload_failed",
  "err_turnstile_failed", "err_try_later", "err_unavailable", "err_bad_request",
];

export function formPage(cfg: Config, lang: Lang): Page {
  const other: Lang = lang === "cs" ? "en" : "cs";
  const vars = { org: cfg.orgName };
  const main =
    `<h1>${esc(t(lang, "form_title"))}</h1><p><a href="/?lang=${other}">${esc(t(lang, "lang_other"))}</a></p>` +
    `<p>${esc(t(lang, "form_intro", vars))}</p>` +
    `<form id="request-form"><label>${esc(t(lang, "form_email"))} <input name="email" type="email" required maxlength="254" autocomplete="email"></label>` +
    `<div class="cf-turnstile" data-sitekey="${esc(cfg.turnstileSiteKey)}" data-language="${lang}"></div>` +
    `<button type="submit">${esc(t(lang, "form_submit"))}</button></form><p id="status" role="status"></p>` +
    `<p class="small">${esc(cfg.privacyNotice[lang])}</p>`;
  return {
    body: layout(cfg, lang, {
      title: t(lang, "form_title"),
      main,
      head: `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
      scripts: ["/static/form.js"],
      data: { lang, texts: texts(lang, ["form_sent", ...ERR_KEYS], vars) },
    }),
    csp: csp({ script: ["https://challenges.cloudflare.com"], frame: ["https://challenges.cloudflare.com"] }),
  };
}

export function uploadPage(cfg: Config, lang: Lang, p: { token: string; expiresAt: number }): Page {
  const vars = { org: cfg.orgName, max: formatSize(cfg.maxFileSize, lang) };
  const main =
    `<h1>${esc(t(lang, "up_title"))}</h1><p>${esc(t(lang, "up_intro", vars))}</p>` +
    `<p>${esc(t(lang, "up_valid", { date: formatDate(p.expiresAt, lang, cfg.timeZone) }))}</p>` +
    `<p><label>${esc(t(lang, "up_choose"))} <input id="file" type="file"></label></p>` +
    `<p><button id="send" type="button">${esc(t(lang, "up_send"))}</button></p>` +
    `<p><progress id="progress" max="1" value="0" hidden></progress></p><p id="status" role="status"></p>`;
  return {
    body: layout(cfg, lang, {
      title: t(lang, "up_title"),
      main,
      scripts: ["/static/put.js", "/static/upload.js"],
      data: {
        token: p.token,
        maxSize: cfg.maxFileSize,
        texts: texts(lang, ["up_sending", "up_received", "up_already", "up_network", ...ERR_KEYS], vars),
      },
    }),
    csp: csp({ connect: [cfg.s3Endpoint] }),
  };
}

export function downloadPage(cfg: Config, lang: Lang, p: { token: string; fileName: string; fileSize: number; expiresAt: number }): Page {
  const main =
    `<h1>${esc(t(lang, "dl_title"))}</h1><dl>` +
    `<dt>${esc(t(lang, "dl_file"))}</dt><dd>${esc(p.fileName)}</dd>` +
    `<dt>${esc(t(lang, "dl_size"))}</dt><dd>${esc(formatSize(p.fileSize, lang))}</dd>` +
    `<dt>${esc(t(lang, "dl_valid"))}</dt><dd>${esc(formatDate(p.expiresAt, lang, cfg.timeZone))}</dd></dl>` +
    `<p class="warning">${esc(t(lang, "dl_malware"))}</p>` +
    `<form method="post" action="/d/${esc(p.token)}/download"><button type="submit">${esc(t(lang, "dl_button"))}</button></form>`;
  return { body: layout(cfg, lang, { title: t(lang, "dl_title"), main }), csp: csp({ formAction: [cfg.s3Endpoint] }) };
}

export function messagePage(cfg: Config, lang: Lang, text: string): Page {
  const main = `<h1>${esc(t(lang, "err_title"))}</h1><p>${esc(text)}</p>`;
  return { body: layout(cfg, lang, { title: t(lang, "err_title"), main }), csp: csp() };
}

export function adminPage(cfg: Config): Page {
  const lang = cfg.defaultLang;
  const admKeys = (Object.keys(STRINGS[lang]) as Key[]).filter((k) => k.startsWith("adm_") || k.startsWith("status_"));
  const main =
    `<h1>${esc(t(lang, "adm_title"))}</h1><nav id="tabs"></nav><p id="msg" role="status"></p><section id="view"></section>`;
  return {
    body: layout(cfg, lang, {
      title: t(lang, "adm_title"),
      main,
      scripts: ["/static/put.js", "/static/admin.js"],
      data: {
        lang,
        api: `${cfg.adminPath}/api`,
        maxSize: cfg.maxFileSize,
        maxDays: cfg.linkDaysMax,
        texts: texts(lang, admKeys, { org: cfg.orgName }),
      },
    }),
    csp: csp({ connect: [cfg.s3Endpoint] }),
  };
}

export function pageResponse(page: Page, status = 200): Response {
  return html(page.body, page.csp, status);
}
