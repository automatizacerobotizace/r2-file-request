import type { Config } from "./config";
import type { AppEnv } from "./env";
import type { Mailer } from "./mailer";

export interface Deps {
  env: AppEnv;
  cfg: Config;
  mailer: Mailer;
  fetch: typeof fetch;
  now: () => number;
}
