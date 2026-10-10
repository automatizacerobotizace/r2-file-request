import { DAY_MS, addAudit, claimSetting } from "./db";
import type { Deps } from "./deps";
import { e6Problem, type ProblemKind } from "./emails";
import type { Mail } from "./mailer";

// E2, E3, E5: one attempt; a failure is only audited (shown as a warning in the admin overview).
export async function sendNotice(deps: Deps, mail: Mail, kind: "E2" | "E3" | "E5", transferId?: string): Promise<void> {
  try {
    await deps.mailer.send(mail);
  } catch {
    await addAudit(deps.env.DB, { ts: deps.now(), actor: "system", action: "mail_failed", transferId, detail: kind });
  }
}

// E6: at most one attempt per kind in 24 hours, reserved before sending so concurrent calls
// and SMTP failures cannot cause more.
export async function notifyProblem(deps: Deps, kind: ProblemKind, detail: string): Promise<void> {
  const db = deps.env.DB;
  const now = deps.now();
  if (!(await claimSetting(db, `e6_${kind}`, now, now - DAY_MS))) return;
  try {
    await deps.mailer.send(e6Problem(deps.cfg, { kind, detail, at: now }));
    await addAudit(db, { ts: now, actor: "system", action: "e6_sent", detail: kind });
  } catch {
    await addAudit(db, { ts: now, actor: "system", action: "mail_failed", detail: `E6:${kind}` });
  }
}
