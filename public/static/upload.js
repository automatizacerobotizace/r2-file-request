"use strict";
(function () {
  const data = JSON.parse(document.getElementById("page-data").textContent);
  const T = data.texts;
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
  const input = document.getElementById("file");
  const button = document.getElementById("send");
  const progress = document.getElementById("progress");
  const status = document.getElementById("status");

  async function post(path) {
    const body = arguments[1] || {};
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      let json = {};
      try { json = await res.json(); } catch {}
      return { ok: res.ok, json };
    } catch {
      return { ok: false, json: { error: "unavailable" } };
    }
  }

  function fail(text) {
    status.textContent = text;
    button.disabled = false;
    input.disabled = false;
  }

  const errText = (r) => T["err_" + r.json.error] || T.err_unavailable;

  button.addEventListener("click", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > data.maxSize) return fail(T.err_too_large);
    button.disabled = true;
    input.disabled = true;
    const start = await post(`/api/u/${data.token}/start`, { name: file.name, size: file.size });
    if (!start.ok) return fail(errText(start));
    progress.hidden = false;
    const st = await window.r2Put(start.json.url, start.json.headers, file, (f) => {
      progress.value = f;
      status.textContent = fill(T.up_sending, { pct: Math.floor(f * 100) });
    });
    if (st !== 200 && st !== 412) return fail(T.up_network);
    const conf = await post(`/api/u/${data.token}/confirm`, {});
    if (!conf.ok) return fail(errText(conf));
    status.textContent = fill(T.up_received, { name: conf.json.fileName });
  });
})();
