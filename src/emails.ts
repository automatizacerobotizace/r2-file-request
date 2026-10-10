import type { Config, Lang } from "./config";
import { formatDate, formatSize } from "./i18n";
import type { Mail } from "./mailer";

export type ProblemKind = "maintenance" | "dns" | "e1_failed" | "cleanup";

const d = (cfg: Config, ms: number, lang: Lang) => formatDate(ms, lang, cfg.timeZone);

export function e1UploadLink(cfg: Config, p: { to: string; lang: Lang; url: string; expiresAt: number }): Mail {
  const max = formatSize(cfg.maxFileSize, p.lang);
  if (p.lang === "cs") {
    return {
      to: p.to,
      subject: `Odkaz pro odeslání souboru – ${cfg.orgName}`,
      text: `Dobrý den,\n\nna této adrese můžete nahrát soubor pro ${cfg.orgName}:\n${p.url}\n\n` +
        `Odkaz platí do ${d(cfg, p.expiresAt, "cs")}. Lze nahrát jeden soubor o velikosti nejvýše ${max}. ` +
        `Více souborů zabalte do ZIP nebo tar.gz. Citlivá data zašifrujte, například v 7-Zip (AES-256), ` +
        `a heslo nám sdělte jinou cestou než e-mailem.\n\nPokud jste o odkaz nežádali, tento e-mail ignorujte.\n\n${cfg.orgName}\n`,
    };
  }
  return {
    to: p.to,
    subject: `Link to send a file – ${cfg.orgName}`,
    text: `Hello,\n\nyou can upload a file for ${cfg.orgName} at this address:\n${p.url}\n\n` +
      `The link is valid until ${d(cfg, p.expiresAt, "en")}. You can upload one file of at most ${max}. ` +
      `Pack several files into ZIP or tar.gz. Encrypt sensitive data, for example with 7-Zip (AES-256), ` +
      `and tell us the password by another channel than e-mail.\n\nIf you did not ask for this link, please ignore this e-mail.\n\n${cfg.orgName}\n`,
  };
}

export function e2NewRequest(cfg: Config, p: { requester: string; createdAt: number; expiresAt: number }): Mail {
  const l = cfg.defaultLang;
  return l === "cs"
    ? { to: cfg.adminEmail, subject: "Nová žádost o nahrání souboru",
        text: `Žadatel: ${p.requester}\nVytvořeno: ${d(cfg, p.createdAt, l)}\nPlatí do: ${d(cfg, p.expiresAt, l)}\n` }
    : { to: cfg.adminEmail, subject: "New file upload request",
        text: `Requester: ${p.requester}\nCreated: ${d(cfg, p.createdAt, l)}\nValid until: ${d(cfg, p.expiresAt, l)}\n` };
}

export function e3FileReceived(cfg: Config, p: { requester: string; fileName: string; fileSize: number; adminUrl: string }): Mail {
  const l = cfg.defaultLang;
  const size = formatSize(p.fileSize, l);
  return l === "cs"
    ? { to: cfg.adminEmail, subject: "Soubor přijat",
        text: `Od: ${p.requester}\nSoubor: ${p.fileName} (${size})\nAdministrace: ${p.adminUrl}\n\nSoubory od zákazníků nejsou kontrolovány na přítomnost malwaru.\n` }
    : { to: cfg.adminEmail, subject: "File received",
        text: `From: ${p.requester}\nFile: ${p.fileName} (${size})\nAdministration: ${p.adminUrl}\n\nFiles received from customers are not scanned for malware.\n` };
}

export function e4DownloadLink(cfg: Config, p: {
  to: string; lang: Lang; url: string; expiresAt: number; fileName: string; fileSize: number;
}): Mail {
  const size = formatSize(p.fileSize, p.lang);
  if (p.lang === "cs") {
    return {
      to: p.to,
      subject: `Soubor ke stažení – ${cfg.orgName}`,
      text: `Dobrý den,\n\n${cfg.orgName} vám posílá soubor ${p.fileName} (${size}). Stáhnout ho můžete zde:\n${p.url}\n\n` +
        `Odkaz platí do ${d(cfg, p.expiresAt, "cs")}.\nPokud je soubor zašifrovaný, heslo vám sdělíme jinou cestou.\n\n${cfg.orgName}\n`,
    };
  }
  return {
    to: p.to,
    subject: `File to download – ${cfg.orgName}`,
    text: `Hello,\n\n${cfg.orgName} is sending you the file ${p.fileName} (${size}). You can download it here:\n${p.url}\n\n` +
      `The link is valid until ${d(cfg, p.expiresAt, "en")}.\nIf the file is encrypted, we will tell you the password by another channel.\n\n${cfg.orgName}\n`,
  };
}

export function e5FirstDownload(cfg: Config, p: { recipient: string; sentAt: number; clickedAt: number; adminUrl: string }): Mail {
  const l = cfg.defaultLang;
  return l === "cs"
    ? { to: cfg.adminEmail, subject: "Příjemce poprvé stahuje soubor",
        text: `Příjemce: ${p.recipient}\nOdesláno: ${d(cfg, p.sentAt, l)}\nKliknuto na Stáhnout: ${d(cfg, p.clickedAt, l)}\nAdministrace: ${p.adminUrl}\n` }
    : { to: cfg.adminEmail, subject: "Recipient started the first download",
        text: `Recipient: ${p.recipient}\nSent: ${d(cfg, p.sentAt, l)}\nClicked Download: ${d(cfg, p.clickedAt, l)}\nAdministration: ${p.adminUrl}\n` };
}

const PROBLEM: Record<ProblemKind, Record<Lang, string>> = {
  maintenance: { cs: "služba přepnuta do údržby", en: "service switched to maintenance" },
  dns: { cs: "chyba DNS při kontrole MX", en: "DNS error during MX check" },
  e1_failed: { cs: "e-mail s odkazem pro nahrání se nepodařilo odeslat", en: "upload link e-mail could not be sent" },
  cleanup: { cs: "opakovaná chyba úklidu", en: "repeated cleanup failure" },
};

export function e6Problem(cfg: Config, p: { kind: ProblemKind; detail: string; at: number }): Mail {
  const l = cfg.defaultLang;
  const what = PROBLEM[p.kind][l];
  return l === "cs"
    ? { to: cfg.adminEmail, subject: `Výměna souborů: ${what} (${p.kind === "dns" ? "DNS" : p.kind})`,
        text: `Problém: ${what}\nČas: ${d(cfg, p.at, l)}\nDetail: ${p.detail}\n\nPodrobnosti jsou v auditu v administraci. Další upozornění stejného typu se pošle nejdříve za 24 hodin.\n` }
    : { to: cfg.adminEmail, subject: `File exchange: ${what} (${p.kind === "dns" ? "DNS" : p.kind})`,
        text: `Problem: ${what}\nTime: ${d(cfg, p.at, l)}\nDetail: ${p.detail}\n\nSee the audit log in the administration. The next notice of the same kind is sent no sooner than 24 hours later.\n` };
}
