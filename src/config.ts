import type { AppEnv } from "./env";

export type Lang = "cs" | "en";

export function asLang(v: string | null | undefined, fallback: Lang): Lang {
  return v === "cs" || v === "en" ? v : fallback;
}

export interface Config {
  origin: string;
  host: string;
  adminPath: string;
  adminEmail: string;
  mailFrom: string;
  orgName: string;
  defaultLang: Lang;
  timeZone: string;
  s3Endpoint: string;
  bucketName: string;
  turnstileSiteKey: string;
  accessTeamDomain: string;
  accessAud: string;
  notifyFirstDownload: boolean;
  privacyNotice: Record<Lang, string>;
  brandCss: string;
  brandLogo: string;
  brandFooterHtml: Record<Lang, string>;
  maxFileSize: number;
  formLimitPerEmail: number;
  formLimitTotal: number;
  uploadLimitTotal: number;
  downloadLimitTotal: number;
  downloadLimitPerLink: number;
  linkDaysMax: number;
  presignSeconds: number;
  draftHours: number;
}

export class ConfigError extends Error {}

// Public paths the admin path must not shadow.
const RESERVED = ["/u", "/d", "/api", "/static", "/brand"];

export function isValidAdminPath(p: string): boolean {
  if (!/^(?:\/[A-Za-z0-9_-]+)+$/.test(p)) return false;
  return !RESERVED.some((r) => p === r || p.startsWith(r + "/"));
}

function int(v: string | undefined, def: number, name: string, max = Number.MAX_SAFE_INTEGER): number {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new ConfigError(`${name} is invalid`);
  return n;
}

// Theme files must come from the service's own /brand/ directory.
function brandPath(v: string | undefined, name: string): string {
  if (!v) return "";
  if (!/^\/brand\/[A-Za-z0-9_.\/-]+$/.test(v) || v.includes("..")) throw new ConfigError(`${name} must be a path under /brand/`);
  return v;
}

export function loadConfig(env: AppEnv): Config {
  if (!isValidAdminPath(env.ADMIN_PATH)) throw new ConfigError("ADMIN_PATH is invalid");
  let origin: URL;
  try {
    origin = new URL(env.PUBLIC_ORIGIN);
  } catch {
    throw new ConfigError("PUBLIC_ORIGIN is invalid");
  }
  if (origin.protocol !== "https:" || origin.origin !== env.PUBLIC_ORIGIN) {
    throw new ConfigError("PUBLIC_ORIGIN must be https://host without a path");
  }
  const defaultLang = asLang(env.DEFAULT_LANG, "en");
  return {
    origin: origin.origin,
    host: origin.host,
    adminPath: env.ADMIN_PATH,
    adminEmail: env.ADMIN_EMAIL,
    mailFrom: env.MAIL_FROM,
    orgName: env.ORG_NAME,
    defaultLang,
    timeZone: env.TIME_ZONE || "UTC",
    s3Endpoint: env.R2_S3_ENDPOINT.replace(/\/$/, ""),
    bucketName: env.R2_BUCKET_NAME,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    accessTeamDomain: env.ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, "").replace(/\/$/, ""),
    accessAud: env.ACCESS_AUD,
    notifyFirstDownload: env.NOTIFY_FIRST_DOWNLOAD !== "false",
    privacyNotice: { cs: env.PRIVACY_NOTICE_CS ?? "", en: env.PRIVACY_NOTICE_EN ?? "" },
    brandCss: brandPath(env.BRAND_CSS, "BRAND_CSS"),
    brandLogo: brandPath(env.BRAND_LOGO, "BRAND_LOGO"),
    brandFooterHtml: {
      cs: env.BRAND_FOOTER_HTML_CS || env.BRAND_FOOTER_HTML_EN || "",
      en: env.BRAND_FOOTER_HTML_EN || env.BRAND_FOOTER_HTML_CS || "",
    },
    maxFileSize: int(env.MAX_FILE_BYTES, 3_000_000_000, "MAX_FILE_BYTES", 5_000_000_000),
    formLimitPerEmail: int(env.REQUESTS_PER_EMAIL, 3, "REQUESTS_PER_EMAIL"),
    formLimitTotal: int(env.DAILY_REQUESTS, 20, "DAILY_REQUESTS"),
    uploadLimitTotal: int(env.DAILY_UPLOADS, 20, "DAILY_UPLOADS"),
    downloadLimitTotal: int(env.DAILY_DOWNLOADS, 20, "DAILY_DOWNLOADS"),
    downloadLimitPerLink: int(env.DOWNLOADS_PER_LINK, 5, "DOWNLOADS_PER_LINK"),
    linkDaysMax: int(env.LINK_DAYS, 7, "LINK_DAYS", 7),
    presignSeconds: int(env.PRESIGN_SECONDS, 120, "PRESIGN_SECONDS", 3600),
    draftHours: int(env.DRAFT_HOURS, 24, "DRAFT_HOURS"),
  };
}
