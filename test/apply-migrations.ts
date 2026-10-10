import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files may run several times; applyD1Migrations skips applied migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
