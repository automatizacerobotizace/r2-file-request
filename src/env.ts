// Bindings, variables and secrets of the Worker. Kept by hand (not generated)
// so that secrets are typed too.
export interface AppEnv {
  DB: D1Database;
  BUCKET: R2Bucket;

  PUBLIC_ORIGIN: string;
  ADMIN_PATH: string;
  ADMIN_EMAIL: string;
  MAIL_FROM: string;
  ORG_NAME: string;
  DEFAULT_LANG: string;
  TIME_ZONE: string;

  SMTP_HOST: string;
  SMTP_PORT: string;
  SMTP_USER: string;
  SMTP_PASSWORD: string;

  R2_S3_ENDPOINT: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;

  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;

  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;

  NOTIFY_FIRST_DOWNLOAD?: string;
  PRIVACY_NOTICE_CS?: string;
  PRIVACY_NOTICE_EN?: string;
  BRAND_CSS?: string;
  BRAND_LOGO?: string;
  BRAND_FOOTER_HTML_CS?: string;
  BRAND_FOOTER_HTML_EN?: string;

  MAX_FILE_BYTES?: string;
  REQUESTS_PER_EMAIL?: string;
  DAILY_REQUESTS?: string;
  DAILY_UPLOADS?: string;
  DAILY_DOWNLOADS?: string;
  DOWNLOADS_PER_LINK?: string;
  LINK_DAYS?: string;
  PRESIGN_SECONDS?: string;
  DRAFT_HOURS?: string;
}
