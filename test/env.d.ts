import type { D1Migration } from "cloudflare:test";
import type { AppEnv } from "../src/env";

// `env` from "cloudflare:workers" is typed as Cloudflare.Env (generated in
// worker-configuration.d.ts); add the secrets from AppEnv and the test-only binding.
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
