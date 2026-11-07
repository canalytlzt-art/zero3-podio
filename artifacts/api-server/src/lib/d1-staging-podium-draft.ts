import { classifyD1Failure } from "./d1-staging-shared";

export type D1PodiumDraftRow = {
  event_id: string;
  category: string;
  registration_ids: string;
  published: number;
  published_by: string | null;
  published_at: string | null;
  publish_reason: string | null;
  version: number;
  updated_at: string;
};

export type D1PublishedPodiumRow = Pick<
  D1PodiumDraftRow,
  "category" | "registration_ids" | "published" | "version"
>;

const PODIUM_VERSION_COLUMNS =
  "event_id,category,registration_ids,published,published_by,published_at,publish_reason,version,updated_at";

export class D1PodiumDraftVersionConflict extends Error {
  constructor() {
    super("The podium draft version changed during save.");
    this.name = "D1PodiumDraftVersionConflict";
  }
}

export async function listD1PodiumVersions(
  DB: D1Database,
  eventId: string,
  category: string,
): Promise<D1PodiumDraftRow[]> {
  const result = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
    FROM zero3_podium_versions WHERE event_id=? AND category=? ORDER BY version DESC`)
    .bind(eventId, category).all<D1PodiumDraftRow>();
  return result.results;
}

export async function listD1PublishedPodiumRows(
  DB: D1Database,
  eventId: string,
): Promise<D1PublishedPodiumRow[]> {
  const result = await DB.prepare(`SELECT category,registration_ids,published,version
    FROM zero3_podium_versions WHERE event_id=? AND published=1 ORDER BY version DESC`)
    .bind(eventId).all<D1PublishedPodiumRow>();
  return result.results;
}

export async function saveD1PodiumDraft(
  DB: D1Database,
  input: {
    eventId: string;
    category: string;
    registrationIds: Array<string | null>;
    updatedAt: string;
  },
): Promise<D1PodiumDraftRow> {
  const latest = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
    FROM zero3_podium_versions WHERE event_id=? AND category=? ORDER BY version DESC LIMIT 1`)
    .bind(input.eventId, input.category).first<D1PodiumDraftRow>();

  if (latest?.published === 0) {
    // Compare the complete snapshot we read. A version number alone is not a
    // compare-and-swap token because draft edits intentionally keep the same
    // version until publication.
    const result = await DB.prepare(`UPDATE zero3_podium_versions
      SET registration_ids=?,updated_at=?
      WHERE event_id=? AND category=? AND version=? AND published=0
        AND registration_ids=? AND updated_at=?`)
      .bind(
        JSON.stringify(input.registrationIds),
        input.updatedAt,
        input.eventId,
        input.category,
        latest.version,
        latest.registration_ids,
        latest.updated_at,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) throw new D1PodiumDraftVersionConflict();

    const saved = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
      FROM zero3_podium_versions WHERE event_id=? AND category=? AND version=?`)
      .bind(input.eventId, input.category, latest.version).first<D1PodiumDraftRow>();
    if (!saved) throw new Error("Saved podium draft could not be reloaded.");
    return saved;
  }

  const version = (latest?.version ?? 0) + 1;
  try {
    await DB.prepare(`INSERT INTO zero3_podium_versions
      (event_id,category,registration_ids,published,published_by,published_at,publish_reason,version,updated_at)
      VALUES(?,?,?,0,NULL,NULL,NULL,?,?)`)
      .bind(
        input.eventId,
        input.category,
        JSON.stringify(input.registrationIds),
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

  const saved = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
    FROM zero3_podium_versions WHERE event_id=? AND category=? AND version=?`)
    .bind(input.eventId, input.category, version).first<D1PodiumDraftRow>();
  if (!saved) throw new Error("Saved podium draft could not be reloaded.");
  return saved;
}

export type D1PodiumPublishOutcome =
  | { kind: "MISSING" }
  | { kind: "INVALID_SELECTION" }
  | { kind: "CONFLICT" }
  | { kind: "PUBLISHED" | "ALREADY_PUBLISHED"; podium: D1PodiumDraftRow };

export async function publishD1PodiumDraft(
  DB: D1Database,
  input: {
    eventId: string;
    category: string;
    publishedBy: string;
    reason: string;
    publishedAt: string;
  },
): Promise<D1PodiumPublishOutcome> {
  const readLatest = () => DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
    FROM zero3_podium_versions WHERE event_id=? AND category=? ORDER BY version DESC LIMIT 1`)
    .bind(input.eventId, input.category).first<D1PodiumDraftRow>();
  const draft = await readLatest();
  if (!draft) return { kind: "MISSING" };
  if (draft.published === 1) return { kind: "ALREADY_PUBLISHED", podium: draft };

  let registrationIds: string[];
  try {
    const parsed: unknown = JSON.parse(draft.registration_ids);
    registrationIds = Array.isArray(parsed) && parsed.every((id) => typeof id === "string")
      ? parsed
      : [];
  } catch {
    registrationIds = [];
  }
  if (registrationIds.length !== 3 || new Set(registrationIds).size !== 3) {
    return { kind: "INVALID_SELECTION" };
  }

  const registrations = await DB.prepare(`SELECT id,category FROM zero3_registrations
    WHERE event_id=? AND id IN (?,?,?)`)
    .bind(input.eventId, ...registrationIds)
    .all<{ id: string; category: string }>();
  if (registrations.results.length !== 3 ||
      registrations.results.some((row) => row.category !== input.category)) {
    return { kind: "INVALID_SELECTION" };
  }

  const update = await DB.prepare(`UPDATE zero3_podium_versions
    SET published=1,published_by=?,published_at=?,publish_reason=?,updated_at=?
    WHERE event_id=? AND category=? AND version=? AND published=0
      AND registration_ids=? AND updated_at=?`)
    .bind(
      input.publishedBy,
      input.publishedAt,
      input.reason,
      input.publishedAt,
      input.eventId,
      input.category,
      draft.version,
      draft.registration_ids,
      draft.updated_at,
    )
    .run();
  if ((update.meta.changes ?? 0) !== 1) {
    const current = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
      FROM zero3_podium_versions WHERE event_id=? AND category=? AND version=?`)
      .bind(input.eventId, input.category, draft.version).first<D1PodiumDraftRow>();
    if (current?.published === 1) return { kind: "ALREADY_PUBLISHED", podium: current };
    return { kind: "CONFLICT" };
  }

  const published = await DB.prepare(`SELECT ${PODIUM_VERSION_COLUMNS}
    FROM zero3_podium_versions WHERE event_id=? AND category=? AND version=?`)
    .bind(input.eventId, input.category, draft.version).first<D1PodiumDraftRow>();
  if (!published) throw new Error("Published podium could not be reloaded.");
  return { kind: "PUBLISHED", podium: published };
}
