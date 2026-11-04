import { d1Date } from "./d1-staging-shared";

export type D1HeatRunRow = {
  event_id: string;
  proof_id: string;
  battery_order: number;
  state: string;
  elapsed_ms: number;
  started_at: string | null;
  preparation_ends_at: string | null;
  version: number;
  last_command_id: string | null;
  updated_at: string;
};

export async function advanceD1TimerPreparation(
  DB: D1Database,
  row: D1HeatRunRow,
  now: Date,
): Promise<D1HeatRunRow> {
  if (row.state !== "PREPARATION" || !row.preparation_ends_at) return row;
  const preparationEnd = Date.parse(row.preparation_ends_at);
  if (!Number.isFinite(preparationEnd) || preparationEnd > now.getTime()) return row;

  await DB.prepare(`UPDATE zero3_heat_runs
    SET state='RUNNING',started_at=preparation_ends_at,preparation_ends_at=NULL,
        version=version+1,updated_at=?
    WHERE event_id=? AND proof_id=? AND battery_order=? AND state='PREPARATION'
      AND version=? AND preparation_ends_at=?`)
    .bind(now.toISOString(), row.event_id, row.proof_id, row.battery_order,
      row.version, row.preparation_ends_at)
    .run();

  return await DB.prepare(`SELECT * FROM zero3_heat_runs
    WHERE event_id=? AND proof_id=? AND battery_order=?`)
    .bind(row.event_id, row.proof_id, row.battery_order)
    .first<D1HeatRunRow>() ?? row;
}

export function d1TimerDto(
  row: D1HeatRunRow,
  eventId: string,
  preparationSeconds: number,
  now = new Date(),
) {
  const elapsedMs = Math.floor(row.elapsed_ms +
    (row.state === "RUNNING" && row.started_at
      ? Math.max(0, now.getTime() - Date.parse(row.started_at))
      : 0));
  return {
    eventId,
    state: row.state,
    elapsedMs,
    preparationRemainingMs: row.state === "PREPARATION" && row.preparation_ends_at
      ? Math.max(0, Math.ceil(Date.parse(row.preparation_ends_at) - now.getTime()))
      : 0,
    preparationSeconds,
    startedAt: d1Date(row.started_at),
    version: row.version,
    updatedAt: d1Date(row.updated_at),
    proofId: row.proof_id,
    batteryOrder: row.battery_order,
  };
}
