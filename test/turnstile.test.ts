import { describe, expect, it } from "vitest";
import { verifyTurnstile } from "../src/turnstile";
import { SITEVERIFY, fakeFetch } from "./fake-fetch";

describe("verifyTurnstile", () => {
  it("posts secret and response and accepts success", async () => {
    let form = new FormData();
    const f = fakeFetch({
      [SITEVERIFY]: async (req) => {
        form = await req.formData();
        return Response.json({ success: true });
      },
    });
    expect(await verifyTurnstile("tok", "sec", f)).toBe(true);
    expect(form.get("secret")).toBe("sec");
    expect(form.get("response")).toBe("tok");
  });

  it("rejects failure, empty token, HTTP and network errors", async () => {
    expect(await verifyTurnstile("tok", "s", fakeFetch({ [SITEVERIFY]: () => Response.json({ success: false }) }))).toBe(false);
    expect(await verifyTurnstile("", "s", fakeFetch({}))).toBe(false);
    expect(await verifyTurnstile("tok", "s", fakeFetch({ [SITEVERIFY]: () => new Response("", { status: 500 }) }))).toBe(false);
    expect(await verifyTurnstile("tok", "s", fakeFetch({ [SITEVERIFY]: () => { throw new Error("x"); } }))).toBe(false);
  });
});
