import { describe, expect, it } from "vitest";
import { call, setup } from "./helpers";

const footerCs = "<p>Patička <a href='https://example.com/vop.pdf'>VOP</a></p>";

describe("custom theme (BRAND_*)", () => {
  it("without settings: no theme stylesheet, logo or footer", async () => {
    const c = await setup();
    const body = await (await call(c, "GET", "/")).text();
    expect(body).not.toContain("/brand/");
    expect(body).not.toContain("<footer");
  });

  it("with settings: theme after the base stylesheet, logo, footer in the page language", async () => {
    const c = await setup({
      BRAND_CSS: "/brand/t.css", BRAND_LOGO: "/brand/logo.webp",
      BRAND_FOOTER_HTML_CS: footerCs, BRAND_FOOTER_HTML_EN: "<p>Footer</p>",
    });
    const cs = await (await call(c, "GET", "/?lang=cs")).text();
    expect(cs.indexOf("/static/style.css")).toBeLessThan(cs.indexOf('href="/brand/t.css"'));
    expect(cs).toContain('<img class="brand-logo" src="/brand/logo.webp" alt="Example">');
    expect(cs).toContain(`<footer class="site-footer">${footerCs}</footer>`);
    const en = await (await call(c, "GET", "/?lang=en")).text();
    expect(en).toContain('<footer class="site-footer"><p>Footer</p></footer>');
    expect(await (await call(c, "GET", "/u/nope")).text()).toContain('href="/brand/t.css"');
  });

  it("falls back to the other language footer", async () => {
    const c = await setup({ BRAND_FOOTER_HTML_CS: footerCs });
    expect(await (await call(c, "GET", "/?lang=en")).text()).toContain(footerCs);
  });

  it("theme path outside /brand/: 500", async () => {
    const c = await setup({ BRAND_CSS: "https://evil.example/x.css" });
    expect((await call(c, "GET", "/")).status).toBe(500);
  });
});
