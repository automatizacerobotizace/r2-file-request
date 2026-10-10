import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "../src/db";
import { getMaintenance } from "../src/maintenance";
import { call, mailsTo, putObject, requestUploadLink, setup } from "./helpers";

describe("traffic just below the limits", () => {
  it("three days of 19 requests and 19 uploads: no maintenance, E2 and E3 for each", async () => {
    const c = await setup();
    for (let day = 0; day < 3; day++) {
      for (let i = 0; i < 19; i++) {
        const { token, id } = await requestUploadLink(c, `u${day}x${i}@example.org`);
        await call(c, "POST", `/api/u/${token}/start`, { json: { name: "a.zip", size: 1 } });
        await putObject(`in/${id}`, "a.zip", 1);
        await call(c, "POST", `/api/u/${token}/confirm`, { json: {} });
        c.clock.advance(60_000);
      }
      c.clock.advance(DAY_MS);
    }
    expect(await getMaintenance(env.DB)).toBeNull();
    const toAdmin = mailsTo(c, "admin@example.com");
    expect(toAdmin.filter((m) => m.subject === "New file upload request")).toHaveLength(57);
    expect(toAdmin.filter((m) => m.subject === "File received")).toHaveLength(57);
  }, 60_000);
});
