import { classifyD1Failure } from "./d1-staging-shared";

export type D1PodiumDraftRow = {
  event_id: string;
  category: string;
  registration_ids: string;
  arbitration_note: string | null;
  published: number;
  published_by: string | null;
  published_at: string | null;
  publish_reason: string | null;
  version: number;
  updated_at: string;
};

export class D1PodiumDraftVersionConflict extends Error {
  constructor() {
    super("The podium draft version changed during save.");
    this.name = "D1PodiumDraftVersionConflict";
  }
}

export async function saveD1PodiumDraft(
  DB: D1Database,
  input: {
    eventId: string;
    category: string;
    registrationIds: Array<string | null>;
    arbitrationNote: string | null;
    updatedAt: string;
  },
): Promise<D1PodiumDraftRow> {
  const latest = await DB.prepare(`SELECT * FROM zero3_podium_versions
    WHERE event_id=? AND category=? ORDER BY version DESC LIMIT 1`)
    .bind(input.eventId, input.category).first<D1PodiumDraftRow>();

  if (latest?.published === 0) {
    // Compare the complete snapshot we read. A version number alone is not a
    // compare-and-swap token because draft edits intentionally keep the same
    // version until publication.
    const result = await DB.prepare(`UPDATE zero3_podium_versions
      SET registration_ids=?,arbitration_note=?,updated_at=?
      WHERE event_id=? AND category=? AND version=? AND published=0
        AND registration_ids=? AND updated_at=? AND arbitration_note IS ?`)
      .bind(
        JSON.stringify(input.registrationIds),
        input.arbitrationNote,
        input.updatedAt,
        input.eventId,
        input.category,
        latest.version,
        latest.registration_ids,
        latest.updated_at,
        latest.arbitration_note ?? null,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) throw new D1PodiumDraftVersionConflict();

    const saved = await DB.prepare(`SELECT * FROM zero3_podium_versions
      WHERE event_id=? AND category=? AND version=?`)
      .bind(input.eventId, input.category, latest.version).first<D1PodiumDraftRow>();
    if (!saved) throw new Error("Saved podium draft could not be reloaded.");
    return saved;
  }

  const version = (latest?.version ?? 0) + 1;
  try {
    await DB.prepare(`INSERT INTO zero3_podium_versions
      (event_id,category,registration_ids,arbitration_note,published,published_by,published_at,publish_reason,version,updated_at)
      VALUES(?,?,?,?,0,NULL,NULL,NULL,?,?)`)
      .bind(
        input.eventId,
        input.category,
        JSON.stringify(input.registrationIds),
        input.arbitrationNote,
        version,
        input.updatedAt,
      )
      .run();
  } catch (error) {
    if (classifyD1Failure(error) === "PODIUM_VERSION_CONFLICT") {
      throw new D1PodiumDraftVersionConflict();
    }
    throw error;
  }

  const saved = await DB.prepare(`SELECT * FROM zero3_podium_versions
    WHERE event_id=? AND category=? AND version=?`)
    .bind(input.eventId, input.category, version).first<D1PodiumDraftRow>();
  if (!saved) throw new Error("Saved podium draft could not be reloaded.");
  return saved;
}
