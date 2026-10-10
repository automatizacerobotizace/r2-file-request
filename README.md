# r2-file-request

Exchange one file (up to 3 GB) between you and a customer, in both directions, using Cloudflare Workers, R2 and D1. There is no server to maintain.

- **Customer → you:** the customer enters their e-mail address and receives a link to upload one file.
- **You → customer:** you upload a file in the admin area and the customer receives a download link.
- Every link expires after at most 7 days. After that the file is deleted.

This is built for small, low-volume use between a company and its customers. It is not a public file hosting service. It favours simplicity and predictable costs over availability.

> **Status:** provided as-is; see [Project status](#project-status).
>

## How it works

```
Browser ──(control: request link, get signed URL, confirm)──► Cloudflare Worker ──► D1
   │
   └──(file content: one PUT / GET via a signed URL)──────────► R2 bucket
```

- File content never passes through the Worker. The browser uploads to R2 and downloads from R2 directly, using short-lived signed URLs (2 minutes to start the transfer).
- The admin area (pages and API under one configurable path, `/admin` by default) is protected by Cloudflare Access.
- A scheduled job runs every 15 minutes and removes expired files.

## Features

- One file per link, up to 3 GB. Customers pack multiple files into a ZIP or tar.gz.
- A link accepts only the first uploaded file. Once uploaded, the file cannot be overwritten.
- Up to 5 download clicks per link. Resending the link from the admin area issues a new link and resets the count.
- Global daily limits for customers: link requests, uploads and downloads (20 each by default). When any global limit is reached, the service switches to maintenance mode until an admin turns it off.
- Link request form protected by Cloudflare Turnstile, an MX check on the e-mail domain, and a per-address limit.
- Plain-text e-mail notifications over SMTP.
- User interface in Czech and English.
- No cookies set by the application itself.

## Non-goals

Multiple files per link, resumable uploads, permanent storage, malware scanning, password-protected shares, HTML e-mails, multiple admin roles.

## Requirements

- A Cloudflare account with R2 enabled. The Workers Free plan is sufficient.
- A domain whose DNS is managed by Cloudflare, for the Worker's custom domain and for Cloudflare Access.
- An SMTP mailbox for sending notifications (port 587, STARTTLS).
- Node.js 22 or newer for building and deploying.

## Data location

Choose where your data is stored. R2 buckets and D1 databases support jurisdictions (for example `eu`). **The jurisdiction can only be set when the bucket or database is created**, either in the Cloudflare dashboard ("Specify jurisdiction") or with wrangler's `--jurisdiction` option.

A bucket created in a jurisdiction has its own S3 endpoint, for example `https://<account_id>.eu.r2.cloudflarestorage.com` for `eu`. Put this endpoint in the configuration.

A jurisdiction restricts where data is **stored**. The Worker itself runs at the Cloudflare location closest to the user.

## Setup

We recommend two environments, staging and production (see [Staging environment](#staging-environment-recommended)). Repeat steps 2–6, 8 and 9 for each.

1. **Install:** clone the repository and run `npm ci --ignore-scripts`, so that `npx wrangler` below uses the pinned Wrangler version.
2. **R2**
   - Create a bucket, in a jurisdiction if you need one.
   - Add a lifecycle rule that deletes objects `DRAFT_HOURS` + `LINK_DAYS` + 1 day after upload, for the whole bucket, as a safety net. With the defaults (24 hours and 7 days) that is 9 days. The rule is not an exact timer: R2 usually deletes within a further 24 hours.
   - Keep public access disabled: do not enable the `r2.dev` address and do not connect a custom domain to the bucket. Otherwise anyone who knows a file's path could download it, bypassing links, limits and expiry.
   - Set CORS (bucket → Settings → CORS policy): allow origin `https://fileshare.example.com`, methods `PUT` and `GET`, headers `content-type`, `if-none-match` and `x-amz-meta-filename`:
     ```json
     [{ "AllowedOrigins": ["https://fileshare.example.com"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type", "if-none-match", "x-amz-meta-filename"], "MaxAgeSeconds": 600 }]
     ```
3. **R2 API token:** create a token with Object Read & Write permission for this bucket only.
4. **D1:** create a database, in the same jurisdiction if needed.
5. **Turnstile:** create a widget for your domain.
6. **Access:** create one application for `fileshare.example.com<ADMIN_PATH>` (including everything below it) and allow only the admin's e-mail address. Note the application's `aud` tag.
7. **Configuration:** copy `wrangler.example.jsonc` to `wrangler.jsonc` and fill in your values (see below). `wrangler.jsonc` is ignored by git.
8. **Migrate:** run `npx wrangler d1 migrations apply <db-name> --remote` (add `--env staging` for staging). Wrangler reads the database binding from `wrangler.jsonc`.
9. **Secrets:** add each secret with `npx wrangler secret put <NAME>` (add `--env staging` for staging). If the Worker does not exist yet, Wrangler offers to create it. Once the Worker exists, you can also set secrets in the Cloudflare dashboard under Worker → Settings → Variables and Secrets. Secrets are set per environment, and `wrangler deploy` preserves them.
10. **Theme (optional):** put your stylesheet, logo and fonts into `public/brand/` (ignored by git) and set the `BRAND_*` values. Without them the pages use a simple light/dark theme.
11. **Deploy:** run `npm test && npx wrangler deploy`. To keep `ADMIN_PATH` out of every file, pass it at deploy time instead: `npx wrangler deploy --var ADMIN_PATH:/your-path`. Use the same path in the Access application.

Keep `workers_dev` disabled, disable preview URLs, and leave Workers Logs off. Request paths contain link tokens, so logs would record them.

### Configuration

| Key | Example | Meaning |
|---|---|---|
| `PUBLIC_ORIGIN` | `https://fileshare.example.com` | public URL; also used for the admin `Origin` check |
| `ADMIN_PATH` | `/admin` | path of the admin area (pages and API); in `vars` or passed with `--var` at deploy time; must start with `/`, must not end with `/`, must not collide with public paths |
| `R2_S3_ENDPOINT` | `https://<account_id>.eu.r2.cloudflarestorage.com` | S3 endpoint of the bucket |
| `R2_BUCKET_NAME` | `fileshare` | bucket name |
| `ACCESS_TEAM_DOMAIN` | `https://example.cloudflareaccess.com` | Access team domain |
| `ACCESS_AUD` | `…` | Access application `aud` tag |
| `TURNSTILE_SITE_KEY` | `…` | Turnstile site key |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` | `smtp.example.com`, `587`, `fileshare@example.com` | SMTP server and login |
| `MAIL_FROM`, `ADMIN_EMAIL` | `fileshare@example.com`, `admin@example.com` | sender address and admin notification address |
| `ORG_NAME` | `Example` | organisation name shown on the pages and in e-mails |
| `DEFAULT_LANG` | `en` | default language of pages and admin e-mails: `cs` or `en` |
| `TIME_ZONE` | `UTC` | IANA time zone for displayed dates, for example `Europe/Prague` |
| `MAX_FILE_BYTES` | `3000000000` | maximum file size |
| `LINK_DAYS` | `7` | maximum link validity in days (at most 7); raise the R2 lifecycle rule accordingly |
| `DAILY_REQUESTS`, `DAILY_UPLOADS`, `DAILY_DOWNLOADS` | `20` | global daily limits for customers |
| `REQUESTS_PER_EMAIL`, `DOWNLOADS_PER_LINK` | `3`, `5` | per-address and per-link limits |
| `NOTIFY_FIRST_DOWNLOAD` | `true` | e-mail the admin on the first download |
| `PRIVACY_NOTICE_CS`, `PRIVACY_NOTICE_EN` | `We process your e-mail address…` | privacy notice shown on the request form, per page language |
| `PRESIGN_SECONDS` | `120` | validity of a signed URL in seconds (never beyond the link's expiry) |
| `DRAFT_HOURS` | `24` | hours after which an unsent admin upload (draft) is removed; raise the R2 lifecycle rule accordingly |
| `BRAND_CSS`, `BRAND_LOGO` | `/brand/theme.css`, `/brand/logo.webp` | optional theme stylesheet and header logo; paths must start with `/brand/` |
| `BRAND_FOOTER_HTML_CS`, `BRAND_FOOTER_HTML_EN` | `<p>Example Ltd.</p>` | optional footer HTML per page language |

Secrets: `SMTP_PASSWORD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `TURNSTILE_SECRET`.

### Staging environment (recommended)

Run a staging environment next to production, as Wrangler environments in one `wrangler.jsonc`: the top level is production, `env.staging` is staging. Give staging its own Worker, custom domain (for example `staging.example.com`), bucket, D1 database, Turnstile widget, sender mailbox and `ORG_NAME`. Wrangler environments do not inherit `vars` or bindings (R2, D1), so repeat them under `env.staging`; override `routes` so staging gets its own hostname, and list `triggers` there too to keep it explicit. Put the whole staging hostname behind Cloudflare Access.

Deploy and migrate staging with `--env staging` (for example `npx wrangler deploy --env staging`), check it, then deploy production without `--env`.

### Deploying from GitHub Actions (optional)

You can deploy from a GitHub Actions workflow in your own private repository instead of from your machine. Keep a private copy of your `wrangler.jsonc` and your theme files (`brand/`) there. The workflow runs `npm ci --ignore-scripts` and `npm test`, copies `wrangler.jsonc` to the project root and `brand/` into `public/brand/`, runs `npx wrangler d1 migrations apply <db-name> --remote`, then `npx wrangler deploy` (with `--var ADMIN_PATH:…` if you keep the path out of the files).

- Use a GitHub Environment with required reviewers for production.
- Store `ADMIN_PATH` as a secret, not as a variable: GitHub does not mask variables in the run log.
- Give the Cloudflare API token only the permissions needed to deploy, and store it only in the CI secret store.
- Application secrets stay in the Worker (step 9), not in the repository.

## Operations

- **Maintenance mode:** switched on automatically when a global daily limit is reached, and you receive an e-mail. Check the audit log in the admin area, then switch maintenance mode off.
- **Emergency brake:** revoking the R2 API token in the Cloudflare dashboard stops all signed URLs already issued from being used, once the permission change has propagated. Cloudflare propagates permission changes gradually, and a transfer that is already running will probably finish. To recover, create a new token and update the secrets.
- **Update:** `git pull`, then `npm ci --ignore-scripts`, then `npm test`, then `npx wrangler deploy` (staging first with `--env staging`, if you run one).
- **Roll back:** `npx wrangler rollback`. D1 migrations only move forward.

## Costs

For low-volume use, everything usually fits in the free tiers: R2 includes 10 GB-month of storage and 1 million Class A and 10 million Class B operations per month.

Cloudflare offers no spending cap. What limits the cost of abuse:

- daily limits
- automatic maintenance mode
- 2-minute validity of signed URLs

Signed URLs that were already issued can still be reused until they expire.

Steady traffic just below the daily limits never triggers maintenance mode. You will notice it because the admin receives an e-mail for every link request and every upload. You can then turn maintenance mode on manually. Check current pricing at <https://developers.cloudflare.com/r2/pricing/>.

## Security

- **Link tokens:** 256 random bits. Only their SHA-256 hash is stored.
- **Admin area:** Cloudflare Access. The Worker also verifies the Access JWT, so a mismatch between the Access path and `ADMIN_PATH` results in 403, not exposure. A custom `ADMIN_PATH` only hides the address; it is not a security control. Changes are accepted only as `POST` requests with JSON bodies from the exact configured `Origin`.
- **Headers:** strict per-page Content Security Policy, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on pages that contain tokens and on all API responses.
- **Downloads:** files are always served as `Content-Disposition: attachment`.
- **Theme:** the footer HTML from `BRAND_FOOTER_HTML_*` is inserted into every page as is. Only the operator sets it, in the configuration; never put untrusted text there.
- **Encryption:** traffic uses TLS, and R2 encrypts stored objects with AES-256 using keys managed by Cloudflare. This is not end-to-end encryption. The upload page and the e-mails therefore advise encrypting sensitive data before sending it (for example 7-Zip with AES-256) and sharing the password through a different channel.
- **Stored data:** no IP addresses are stored. The cleanup job removes records 90 days after a link ends, once the deletion of the file has been confirmed; if that deletion keeps failing, the records stay until it succeeds. After deletion, D1 Time Travel may retain data for a further 7 days on the Workers Free plan, or 30 days on Workers Paid.

**Malware scanning.** r2-file-request does not scan uploaded files for malware. File contents go directly from the sender's browser to the storage bucket and never pass through the Worker, so server-side scanning is not possible in this architecture. Checking files for malware is the responsibility of the recipient, on the recipient's own computer, before the files are opened.

**Known trade-offs.** This is a deliberately simple design. For example:

- An e-mail may be delivered even though sending reported an error.
- A signed URL can be called directly against R2 any number of times within its 2-minute validity; the daily limits cap the number of URLs, not R2 operations. Cloudflare has no spending cap, so set a budget alert and use the emergency brake if needed.
- Hitting a global limit stops the service until an admin reacts.
- Deleting a transfer tries to remove its object at once; if that fails, the cleanup job removes it. An upload that was already running can still complete afterwards, so the cleanup job keeps deleting the object of an ended transfer, until one deletion has succeeded 24 hours or more after the transfer ended. One run handles up to 90 ended transfers. With no more than 90 of them waiting and the deletions succeeding, such an object disappears within 15 minutes of the upload finishing; with more, the runs take turns and it takes longer. An upload that is still running after those 24 hours is left to the R2 lifecycle rule. The application never serves such an object.
- An upload link works for anyone who has it. If a link has leaked, delete the transfer and create a new one: resending the link makes the old link invalid, but does not discard a file already uploaded through it.
- Steady traffic just below the daily limits does not trigger maintenance mode.

## Development

Requires Node.js 22 or newer. Install dependencies with `npm ci --ignore-scripts`, which installs the exact versions from the lockfile without running install scripts.

```
npm ci --ignore-scripts
npm run typecheck
npm test
```

Tests use Vitest with @cloudflare/vitest-plugin, which runs the tests inside the Workers runtime with local D1 and R2. `npm run typecheck` checks the types with the TypeScript compiler. The browser side has no runtime dependencies.

The CI workflow (`.github/workflows/ci.yml`) runs the same steps on every push and pull request. Its GitHub Actions are pinned to full commit SHAs.

## Project status

This project is provided as-is. The repository is an archived snapshot of a working deployment: no support, no issues, no pull requests. Fork it if you want to change it.

## License

Released into the public domain under [the Unlicense](LICENSE), with one exception: `worker-configuration.d.ts` is generated by `wrangler types` and contains Cloudflare's runtime type declarations, copyright Cloudflare and Microsoft, licensed under the Apache License 2.0 (see [LICENSE-APACHE](LICENSE-APACHE)). Keep its header if you redistribute it, or regenerate it with `npm run types`.

## Credits

The application code in this repository (`src`, `test`, `public`, `migrations`) was written by Claude (Anthropic), under human direction and review.
