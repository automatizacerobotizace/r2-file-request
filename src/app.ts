import { handleAdmin } from "./admin";
import { runCleanup } from "./cleanup";
import { ConfigError, loadConfig } from "./config";
import type { Deps } from "./deps";
import type { AppEnv } from "./env";
import { BASE_HEADERS, apiError } from "./http";
import type { Mailer } from "./mailer";
import { handlePublic, message } from "./public";
import { SmtpMailer } from "./smtp";

export interface Overrides {
  mailer?: Mailer;
  fetch?: typeof fetch;
  now?: () => number;
}

export function makeDeps(env: AppEnv, o: Overrides = {}): Deps {
  const cfg = loadConfig(env);
  return {
    env,
    cfg,
    mailer: o.mailer ?? new SmtpMailer({
      host: env.SMTP_HOST, port: Number(env.SMTP_PORT), user: env.SMTP_USER,
      password: env.SMTP_PASSWORD, from: cfg.mailFrom, fromName: cfg.orgName,
    }),
    fetch: o.fetch ?? fetch.bind(globalThis),
    now: o.now ?? Date.now,
  };
}

export async function handleRequest(req: Request, env: AppEnv, o: Overrides = {}): Promise<Response> {
  let deps: Deps;
  try {
    deps = makeDeps(env, o);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    return new Response("Configuration error", { status: 500, headers: BASE_HEADERS });
  }
  const url = new URL(req.url);
  const p = url.pathname;
  const a = deps.cfg.adminPath;
  const isApi = p.startsWith("/api/") || p.startsWith(`${a}/api/`);
  try {
    if (p === a || p.startsWith(`${a}/`)) return await handleAdmin(req, deps, p.slice(a.length));
    const res = await handlePublic(req, deps, url);
    if (res) return res;
    return isApi ? apiError("not_found", 404) : message(deps, deps.cfg.defaultLang, "err_not_found", 404);
  } catch (e) {
    // Never log the URL: it may contain a token.
    console.error("request failed:", e instanceof Error ? e.name : "unknown");
    return isApi ? apiError("unavailable", 503) : message(deps, deps.cfg.defaultLang, "err_unavailable", 503);
  }
}

export async function handleScheduled(env: AppEnv, o: Overrides = {}): Promise<void> {
  await runCleanup(makeDeps(env, o));
}
