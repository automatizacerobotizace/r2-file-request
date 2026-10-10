"use strict";
(function () {
  const data = JSON.parse(document.getElementById("page-data").textContent);
  const T = data.texts;
  const API = data.api;
  const view = document.getElementById("view");
  const msg = document.getElementById("msg");
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? String(v[k]) : m));
  const dt = (ms) => (ms ? new Date(ms).toLocaleString(data.lang) : "–");
  const size = (b) => b == null ? "–" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b >= 1e3 ? Math.round(b / 1e3) + " kB" : b + " B";
  const field = (form, name) => form.elements.namedItem(name);

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (typeof v === "function") e.addEventListener(k, v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, String(v));
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  const button = (label, onclick) => el("button", { type: "button", click: onclick }, label);
  const table = (heads, rows) => el("table", {}, el("thead", {}, el("tr", {}, heads.map((h) => el("th", {}, h)))), el("tbody", {}, rows));

  async function api(path, body) {
    const init = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    try {
      const res = await fetch(API + path, init);
      let json = {};
      try { json = await res.json(); } catch {}
      return { ok: res.ok, status: res.status, json };
    } catch {
      return { ok: false, status: 0, json: { error: "unavailable" } };
    }
  }

  function report(r) {
    if (r.ok) msg.textContent = T.adm_done;
    else if (r.json.error === "mail_failed") msg.textContent = T.adm_mail_failed;
    else if (r.json.error === "conflict") msg.textContent = T.adm_conflict;
    else msg.textContent = fill(T.adm_error, { code: r.json.error || r.status });
    return r.ok;
  }

  async function act(path, body, reload) {
    report(await api(path, body));
    await reload();
  }

  async function download(id) {
    const r = await api(`/transfers/${id}/download`, {});
    if (report(r)) location.href = r.json.url;
  }

  function del(id, reload) {
    if (confirm(T.adm_confirm_delete)) act(`/transfers/${id}/delete`, {}, reload);
  }

  const langSelect = () => el("select", { name: "lang" }, el("option", { value: "cs" }, "cs"), el("option", { value: "en" }, "en"));
  const daysInput = () => el("input", { name: "days", type: "number", min: 1, max: data.maxDays, value: data.maxDays, required: true });
  const fileCell = (t) => (t.file_name ? `${t.file_name} (${size(t.file_size)})` : "–");

  async function overview() {
    const r = await api("/overview");
    if (!r.ok) return void report(r);
    const m = r.json.maintenance;
    view.replaceChildren(
      el("p", {}, m ? fill(T.adm_maint_on, { since: dt(m.since), reason: m.reason }) : T.adm_maint_off),
      button(m ? T.adm_maint_disable : T.adm_maint_enable, () => act("/maintenance", { on: !m }, overview)),
      el("h2", {}, T.adm_warnings),
      r.json.warnings.length
        ? table([T.adm_ts, T.adm_action, T.adm_detail], r.json.warnings.map((w) =>
            el("tr", {}, el("td", {}, dt(w.ts)), el("td", {}, w.action), el("td", {}, w.detail || ""))))
        : el("p", {}, T.adm_no_warnings),
    );
  }

  async function incoming() {
    const r = await api("/transfers?direction=in");
    if (!r.ok) return void report(r);
    const form = el("form", {}, el("h2", {}, T.adm_new_request),
      el("label", {}, T.adm_email, " ", el("input", { name: "email", type: "email", required: true })), " ",
      el("label", {}, T.adm_days, " ", daysInput()), " ",
      el("label", {}, T.adm_lang, " ", langSelect()), " ",
      el("button", { type: "submit" }, T.adm_create));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      act("/in", { email: field(form, "email").value, days: Number(field(form, "days").value), lang: field(form, "lang").value }, incoming);
    });
    const rows = r.json.transfers.map((t) => el("tr", {},
      el("td", {}, t.email), el("td", {}, dt(t.created_at)), el("td", {}, dt(t.expires_at)),
      el("td", {}, T["status_" + t.status]), el("td", {}, fileCell(t)),
      el("td", {},
        t.status === "received" && button(T.adm_download, () => download(t.id)),
        t.status === "open" && t.origin === "admin" && button(T.adm_resend, () => act(`/transfers/${t.id}/resend`, { linkVersion: t.link_version }, incoming)),
        ["open", "received"].includes(t.status) && button(T.adm_delete, () => del(t.id, incoming)))));
    view.replaceChildren(el("p", { class: "warning" }, T.adm_malware), form,
      table([T.adm_email, T.adm_created, T.adm_expires, T.adm_status, T.adm_file, T.adm_actions], rows));
  }

  async function outgoing() {
    const r = await api("/transfers?direction=out");
    if (!r.ok) return void report(r);
    const prog = el("progress", { max: 1, value: 0, hidden: true });
    const form = el("form", {}, el("h2", {}, T.adm_new_share),
      el("label", {}, T.adm_email, " ", el("input", { name: "email", type: "email", required: true })), " ",
      el("label", {}, T.adm_days, " ", daysInput()), " ",
      el("label", {}, T.adm_lang, " ", langSelect()), " ",
      el("input", { name: "file", type: "file", required: true }), " ",
      el("button", { type: "submit" }, T.adm_upload), prog);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = field(form, "file").files[0];
      if (!file) return;
      if (file.size > data.maxSize) return void (msg.textContent = fill(T.adm_error, { code: "too_large" }));
      const d = await api("/out", {
        email: field(form, "email").value, days: Number(field(form, "days").value), lang: field(form, "lang").value,
        name: file.name, size: file.size,
      });
      if (!report(d)) return;
      prog.hidden = false;
      const st = await window.r2Put(d.json.url, d.json.headers, file, (f) => { prog.value = f; });
      if (st !== 200 && st !== 412) return void (msg.textContent = fill(T.adm_error, { code: "upload " + st }));
      await act(`/transfers/${d.json.id}/confirm`, {}, outgoing);
    });
    const rows = r.json.transfers.map((t) => el("tr", {},
      el("td", {}, t.email), el("td", {}, dt(t.created_at)), el("td", {}, dt(t.expires_at)),
      el("td", {}, T["status_" + t.status]), el("td", {}, fileCell(t)),
      el("td", {}, dt(t.first_download_at)), el("td", {}, String(t.downloads)),
      el("td", {},
        t.uploaded_at && ["draft", "active"].includes(t.status) && button(T.adm_download, () => download(t.id)),
        t.status === "draft" && t.uploaded_at && button(T.adm_send, () => act(`/transfers/${t.id}/send`, {}, outgoing)),
        t.status === "active" && button(T.adm_resend, () => act(`/transfers/${t.id}/resend`, { linkVersion: t.link_version }, outgoing)),
        ["draft", "active"].includes(t.status) && button(T.adm_delete, () => del(t.id, outgoing)))));
    view.replaceChildren(form, table(
      [T.adm_email, T.adm_created, T.adm_expires, T.adm_status, T.adm_file, T.adm_first_dl, T.adm_downloads, T.adm_actions], rows));
  }

  async function audit() {
    const r = await api("/audit");
    if (!r.ok) return void report(r);
    view.replaceChildren(table([T.adm_ts, T.adm_actor, T.adm_action, T.adm_detail], r.json.events.map((a) =>
      el("tr", {}, el("td", {}, dt(a.ts)), el("td", {}, a.actor), el("td", {}, a.action),
        el("td", {}, [a.transfer_id, a.link_version, a.detail].filter((x) => x != null).join(" · "))))));
  }

  const nav = document.getElementById("tabs");
  const tabs = [["adm_tab_overview", overview], ["adm_tab_in", incoming], ["adm_tab_out", outgoing], ["adm_tab_audit", audit]];
  for (const [key, fn] of tabs) {
    nav.append(button(T[key], (e) => {
      for (const b of nav.children) b.removeAttribute("aria-current");
      e.currentTarget.setAttribute("aria-current", "true");
      msg.textContent = "";
      fn();
    }));
  }
  overview();
})();
