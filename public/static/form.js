"use strict";
(function () {
  const data = JSON.parse(document.getElementById("page-data").textContent);
  const form = document.getElementById("request-form");
  const out = document.getElementById("status");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    const tsField = form.elements.namedItem("cf-turnstile-response");
    const payload = { email: form.elements.namedItem("email").value, turnstile: tsField ? tsField.value : "", lang: data.lang };
    let ok = false;
    let body = {};
    try {
      const res = await fetch("/api/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      ok = res.ok;
      body = await res.json();
    } catch {
      body = { error: "unavailable" };
    }
    if (ok) {
      out.textContent = data.texts.form_sent;
      form.hidden = true;
      return;
    }
    out.textContent = data.texts["err_" + body.error] || data.texts.err_unavailable;
    button.disabled = false;
    if (window.turnstile) window.turnstile.reset();
  });
})();
