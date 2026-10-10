import { describe, expect, it } from "vitest";
import { checkMx } from "../src/mx";
import { DOH, dohAnswer, fakeFetch } from "./fake-fetch";

describe("checkMx", () => {
  it("ok when an MX record exists", async () => {
    const f = fakeFetch({ [DOH]: () => dohAnswer(0, [{ type: 15, data: "10 mx.example.org." }]) });
    expect(await checkMx("example.org", f)).toBe("ok");
    expect(f.calls[0]).toBe(`${DOH}?name=example.org&type=MX`);
  });

  it("none for NXDOMAIN, empty answer or null MX", async () => {
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => dohAnswer(3) }))).toBe("none");
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => dohAnswer(0, [{ type: 5, data: "a." }]) }))).toBe("none");
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => dohAnswer(0, [{ type: 15, data: "0 ." }]) }))).toBe("none");
  });

  it("error for SERVFAIL, HTTP error or network failure", async () => {
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => dohAnswer(2) }))).toBe("error");
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => new Response("", { status: 500 }) }))).toBe("error");
    expect(await checkMx("x.test", fakeFetch({ [DOH]: () => { throw new Error("net"); } }))).toBe("error");
  });
});
