import { addAudit, deleteSetting, getSetting, insertSettingIfAbsent } from "./db";
import type { Deps } from "./deps";
import { notifyProblem } from "./notify";

export interface MaintenanceState {
  since: number;
  reason: string;
  actor: string;
}

const KEY = "maintenance";

export async function getMaintenance(db: D1Database): Promise<MaintenanceState | null> {
  const v = await getSetting(db, KEY);
  return v ? (JSON.parse(v) as MaintenanceState) : null;
}

// Returns true when maintenance was newly switched on. Automatic entries (actor "system") send E6.
export async function enterMaintenance(deps: Deps, reason: string, actor: string): Promise<boolean> {
  const now = deps.now();
  const state: MaintenanceState = { since: now, reason, actor };
  if (!(await insertSettingIfAbsent(deps.env.DB, KEY, JSON.stringify(state)))) return false;
  await addAudit(deps.env.DB, { ts: now, actor, action: "maintenance_on", detail: reason });
  if (actor === "system") await notifyProblem(deps, "maintenance", reason);
  return true;
}

export async function leaveMaintenance(deps: Deps, actor: string): Promise<boolean> {
  if (!(await deleteSetting(deps.env.DB, KEY))) return false;
  await addAudit(deps.env.DB, { ts: deps.now(), actor, action: "maintenance_off" });
  return true;
}
