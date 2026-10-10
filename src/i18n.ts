import type { Lang } from "./config";

const cs = {
  app_title: "Výměna souborů",
  lang_other: "English",
  noscript: "Tato stránka potřebuje zapnutý JavaScript.",
  form_title: "Odkaz pro nahrání souboru",
  form_intro: "Po domluvě s {org} si zde vyžádejte odkaz pro nahrání souboru. Odkaz vám pošleme e-mailem.",
  form_email: "Váš e-mail",
  form_submit: "Poslat odkaz",
  form_sent: "Pokud je adresa platná, poslali jsme odkaz.",
  up_title: "Nahrání souboru",
  up_intro: "Pošlete jeden soubor (max. {max}). Více souborů zabalte do ZIP nebo tar.gz. Citlivá data zašifrujte, například v 7-Zip (AES-256), a heslo nám sdělte jinou cestou než e-mailem.",
  up_valid: "Odkaz platí do {date}.",
  up_choose: "Vyberte soubor",
  up_send: "Nahrát",
  up_sending: "Nahrávám… {pct} %",
  up_received: "Soubor {name} byl přijat.",
  up_already: "Soubor už byl přijat.",
  up_network: "Nahrávání se nezdařilo. Zkuste to prosím znovu.",
  dl_title: "Soubor ke stažení",
  dl_file: "Soubor",
  dl_size: "Velikost",
  dl_valid: "Platí do",
  dl_malware: "Upozornění: Soubory nejsou kontrolovány na přítomnost malwaru. Před otevřením je zkontrolujte antivirovým programem.",
  dl_button: "Stáhnout",
  err_title: "Upozornění",
  err_link_invalid: "Odkaz není platný nebo vypršel.",
  err_too_large: "Soubor je větší než {max}.",
  err_download_limit: "Limit stažení je vyčerpán, kontaktujte {org}.",
  err_maintenance: "Služba je v údržbě, zkuste to později nebo kontaktujte {org}.",
  err_upload_failed: "Soubor nedorazil. Nahrajte ho prosím znovu.",
  err_turnstile_failed: "Ověření se nezdařilo, zkuste to znovu.",
  err_try_later: "Žádost se nepodařilo zpracovat, zkuste to prosím později.",
  err_unavailable: "Služba je dočasně nedostupná.",
  err_bad_request: "Neplatný požadavek.",
  err_not_found: "Stránka neexistuje.",
  adm_title: "Administrace",
  adm_tab_overview: "Přehled",
  adm_tab_in: "Příchozí",
  adm_tab_out: "Odchozí",
  adm_tab_audit: "Audit",
  adm_maint_on: "Služba je v údržbě od {since} (důvod: {reason}).",
  adm_maint_off: "Služba běží.",
  adm_maint_enable: "Zapnout údržbu",
  adm_maint_disable: "Vypnout údržbu",
  adm_warnings: "Varování za 7 dní",
  adm_no_warnings: "Žádná varování.",
  adm_email: "E-mail",
  adm_created: "Vytvořeno",
  adm_expires: "Platí do",
  adm_status: "Stav",
  adm_file: "Soubor",
  adm_first_dl: "První stažení",
  adm_downloads: "Stažení",
  adm_actions: "Akce",
  adm_download: "Stáhnout",
  adm_delete: "Smazat",
  adm_resend: "Odeslat znovu",
  adm_send: "Odeslat",
  adm_new_request: "Nová žádost pro zákazníka",
  adm_new_share: "Nové sdílení",
  adm_days: "Platnost (dny)",
  adm_lang: "Jazyk",
  adm_create: "Vytvořit",
  adm_upload: "Nahrát a připravit",
  adm_malware: "Soubory od zákazníků nejsou kontrolovány na přítomnost malwaru. Kontrola obsahu je na počítači příjemce.",
  adm_confirm_delete: "Opravdu smazat?",
  adm_done: "Hotovo.",
  adm_error: "Chyba: {code}",
  adm_mail_failed: "E-mail se nepodařilo odeslat. Použijte Odeslat znovu.",
  adm_conflict: "Stav se mezitím změnil, seznam je obnoven.",
  adm_ts: "Čas",
  adm_actor: "Kdo",
  adm_action: "Akce",
  adm_detail: "Detail",
  status_open: "čeká na soubor",
  status_received: "přijato",
  status_draft: "koncept",
  status_active: "odesláno",
  status_expired: "vypršelo",
  status_deleted: "smazáno",
};

export type Key = keyof typeof cs;

const en: Record<Key, string> = {
  app_title: "File exchange",
  lang_other: "Čeština",
  noscript: "This page needs JavaScript enabled.",
  form_title: "Link to upload a file",
  form_intro: "After arranging it with {org}, request a link to upload a file here. We will send the link by e-mail.",
  form_email: "Your e-mail",
  form_submit: "Send link",
  form_sent: "If the address is valid, we have sent the link.",
  up_title: "Upload a file",
  up_intro: "Send one file (max. {max}). Pack several files into ZIP or tar.gz. Encrypt sensitive data, for example with 7-Zip (AES-256), and tell us the password by another channel than e-mail.",
  up_valid: "The link is valid until {date}.",
  up_choose: "Choose a file",
  up_send: "Upload",
  up_sending: "Uploading… {pct} %",
  up_received: "The file {name} has been received.",
  up_already: "The file has already been received.",
  up_network: "The upload failed. Please try again.",
  dl_title: "File to download",
  dl_file: "File",
  dl_size: "Size",
  dl_valid: "Valid until",
  dl_malware: "Notice: Files are not scanned for malware. Please check them with antivirus software before opening.",
  dl_button: "Download",
  err_title: "Notice",
  err_link_invalid: "The link is not valid or has expired.",
  err_too_large: "The file is larger than {max}.",
  err_download_limit: "The download limit has been reached, please contact {org}.",
  err_maintenance: "The service is under maintenance, please try later or contact {org}.",
  err_upload_failed: "The file did not arrive. Please upload it again.",
  err_turnstile_failed: "Verification failed, please try again.",
  err_try_later: "The request could not be processed, please try again later.",
  err_unavailable: "The service is temporarily unavailable.",
  err_bad_request: "Invalid request.",
  err_not_found: "Page not found.",
  adm_title: "Administration",
  adm_tab_overview: "Overview",
  adm_tab_in: "Incoming",
  adm_tab_out: "Outgoing",
  adm_tab_audit: "Audit",
  adm_maint_on: "The service is under maintenance since {since} (reason: {reason}).",
  adm_maint_off: "The service is running.",
  adm_maint_enable: "Enable maintenance",
  adm_maint_disable: "Disable maintenance",
  adm_warnings: "Warnings in the last 7 days",
  adm_no_warnings: "No warnings.",
  adm_email: "E-mail",
  adm_created: "Created",
  adm_expires: "Valid until",
  adm_status: "Status",
  adm_file: "File",
  adm_first_dl: "First download",
  adm_downloads: "Downloads",
  adm_actions: "Actions",
  adm_download: "Download",
  adm_delete: "Delete",
  adm_resend: "Send again",
  adm_send: "Send",
  adm_new_request: "New request for a customer",
  adm_new_share: "New share",
  adm_days: "Validity (days)",
  adm_lang: "Language",
  adm_create: "Create",
  adm_upload: "Upload and prepare",
  adm_malware: "Files received from customers are not scanned for malware. Checking the content is the recipient's responsibility.",
  adm_confirm_delete: "Really delete?",
  adm_done: "Done.",
  adm_error: "Error: {code}",
  adm_mail_failed: "The e-mail could not be sent. Use Send again.",
  adm_conflict: "The state has changed meanwhile, the list was reloaded.",
  adm_ts: "Time",
  adm_actor: "Who",
  adm_action: "Action",
  adm_detail: "Detail",
  status_open: "waiting for file",
  status_received: "received",
  status_draft: "draft",
  status_active: "sent",
  status_expired: "expired",
  status_deleted: "deleted",
};

export const STRINGS: Record<Lang, Record<Key, string>> = { cs, en };

export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return fill(STRINGS[lang][key], vars);
}

export function formatDate(ms: number, lang: Lang, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  const hm = `${p("hour").padStart(2, "0")}:${p("minute").padStart(2, "0")}`;
  return lang === "cs"
    ? `${p("day")}. ${p("month")}. ${p("year")} ${hm}`
    : `${p("year")}-${p("month").padStart(2, "0")}-${p("day").padStart(2, "0")} ${hm}`;
}

export function formatSize(bytes: number, lang: Lang): string {
  const units: [number, string][] = [[1e9, "GB"], [1e6, "MB"], [1e3, "kB"]];
  for (const [u, name] of units) {
    if (bytes >= u) {
      const v = bytes / u;
      const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
      return `${lang === "cs" ? s.replace(".", ",") : s} ${name}`;
    }
  }
  return `${bytes} B`;
}
