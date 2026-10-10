import { handleRequest, handleScheduled } from "./app";
import type { AppEnv } from "./env";

export default {
  fetch(req, env) {
    return handleRequest(req, env);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
} satisfies ExportedHandler<AppEnv>;
