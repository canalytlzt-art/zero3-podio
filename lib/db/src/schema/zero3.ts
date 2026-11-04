import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const zero3EventsTable = pgTable("zero3_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  proofName: text("proof_name").notNull(),
  status: text("status").notNull().default("PLANNED"),
  preparationSeconds: integer("preparation_seconds").notNull().default(10),
  categories: jsonb("categories")
    .$type<string[]>()
    .notNull()
    .default(sql`'["SC","RX"]'::jsonb`),
  createdAt: createdAt(),
});

export const zero3ProofsTable = pgTable(
  "zero3_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    order: integer("proof_order").notNull(),
    name: text("name").notNull().default(""),
    metricType: text("metric_type").notNull().default("UNCONFIGURED"),
    unit: text("unit"),
    direction: text("direction"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    proofOrderUnique: uniqueIndex("zero3_proof_order_unique").on(
      table.eventId,
      table.order,
    ),
  }),
);

export const zero3AthletesTable = pgTable("zero3_athletes", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  createdAt: createdAt(),
});

export const zero3RegistrationsTable = pgTable(
  "zero3_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    teamName: text("team_name"),
    athleteIds: jsonb("athlete_ids").$type<string[]>().notNull(),
    laneLabel: text("lane_label"),
    confirmationStatus: text("confirmation_status").notNull().default("PENDING"),
    paymentStatus: text("payment_status").notNull().default("UNVERIFIED"),
    createdAt: createdAt(),
  },
  (table) => ({
    registrationEventUnique: unique("zero3_registration_id_event_unique").on(
      table.id,
      table.eventId,
    ),
    eventCategoryIndex: uniqueIndex("zero3_registration_lane_unique").on(
      table.eventId,
      table.category,
      table.laneLabel,
    ),
  }),
);

export const zero3RegistrationMembersTable = pgTable(
  "zero3_registration_members",
  {
    registrationId: uuid("registration_id").notNull(),
    eventId: uuid("event_id").notNull(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => zero3AthletesTable.id, { onDelete: "restrict" }),
    slot: integer("slot").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.registrationId, table.slot] }),
    distinctAthlete: uniqueIndex("zero3_registration_member_unique").on(
      table.registrationId,
      table.athleteId,
    ),
    athletePerEvent: uniqueIndex("zero3_event_athlete_unique").on(
      table.eventId,
      table.athleteId,
    ),
    registrationEventFk: foreignKey({
      columns: [table.registrationId, table.eventId],
      foreignColumns: [
        zero3RegistrationsTable.id,
        zero3RegistrationsTable.eventId,
      ],
      name: "zero3_registration_member_event_fk",
    }).onDelete("cascade"),
    slotCheck: check("zero3_registration_member_slot_check", sql`${table.slot} BETWEEN 1 AND 2`),
  }),
);

export const zero3RegistrationAuditTable = pgTable(
  "zero3_registration_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "restrict" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => zero3RegistrationsTable.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>().notNull(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
);

export const zero3ImportBatchesTable = pgTable(
  "zero3_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "restrict" }),
    datasetKey: text("dataset_key").notNull(),
    sourceFile: text("source_file").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    sourceNotes: jsonb("source_notes")
      .$type<{ cells: string[]; text: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    contentHash: text("content_hash").notNull(),
    sourceTeamCount: integer("source_team_count").notNull(),
    sourcePeopleCount: integer("source_people_count").notNull(),
    appliedBy: text("applied_by").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    eventDatasetUnique: uniqueIndex("zero3_import_batch_event_dataset_unique").on(
      table.eventId,
      table.datasetKey,
    ),
  }),
);

export const zero3ImportPeopleTable = pgTable(
  "zero3_import_people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => zero3ImportBatchesTable.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    sourceName: text("source_name").notNull(),
    sourceCell: text("source_cell").notNull(),
    athleteId: uuid("athlete_id")
      .notNull()
      .references(() => zero3AthletesTable.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => ({
    batchSourceKeyUnique: uniqueIndex("zero3_import_person_source_unique").on(
      table.batchId,
      table.sourceKey,
    ),
  }),
);

export const zero3ImportTeamsTable = pgTable(
  "zero3_import_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => zero3ImportBatchesTable.id, { onDelete: "cascade" }),
    sourceCode: text("source_code").notNull(),
    sourceCategory: text("source_category").notNull(),
    sourceRow: integer("source_row").notNull(),
    sourceCells: jsonb("source_cells").$type<[string, string]>().notNull(),
    sourceAthleteNames: jsonb("source_athlete_names")
      .$type<[string, string]>()
      .notNull(),
    targetCategory: text("target_category").notNull(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => zero3RegistrationsTable.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => ({
    batchSourceCodeUnique: uniqueIndex("zero3_import_team_source_unique").on(
      table.batchId,
      table.sourceCode,
    ),
    batchRegistrationUnique: uniqueIndex("zero3_import_registration_unique").on(
      table.batchId,
      table.registrationId,
    ),
  }),
);

export const zero3HeatsTable = pgTable(
  "zero3_heats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    order: integer("order").notNull(),
  },
  (table) => ({
    heatOrderUnique: uniqueIndex("zero3_heat_order_unique").on(
      table.eventId,
      table.category,
      table.order,
    ),
  }),
);

export const zero3HeatEntriesTable = pgTable(
  "zero3_heat_entries",
  {
    heatId: uuid("heat_id")
      .notNull()
      .references(() => zero3HeatsTable.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => zero3RegistrationsTable.id, { onDelete: "cascade" }),
    laneLabel: text("lane_label"),
    assignedAt: createdAt(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.heatId, table.registrationId] }),
  }),
);

export const zero3ActiveHeatsTable = pgTable(
  "zero3_active_heats",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    heatId: uuid("heat_id").references(() => zero3HeatsTable.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.category] }),
  }),
);

export const zero3ResultsTable = pgTable(
  "zero3_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => zero3RegistrationsTable.id, { onDelete: "cascade" }),
    proofId: uuid("proof_id").references(() => zero3ProofsTable.id, {
      onDelete: "set null",
    }),
    heatId: uuid("heat_id").references(() => zero3HeatsTable.id, {
      onDelete: "set null",
    }),
    category: text("category").notNull(),
    laneLabel: text("lane_label"),
    athleteIdsSnapshot: jsonb("athlete_ids_snapshot").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    athleteNamesSnapshot: jsonb("athlete_names_snapshot").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    teamNameSnapshot: text("team_name_snapshot"),
    elapsedMs: integer("elapsed_ms"),
    rawValue: numeric("raw_value", { precision: 12, scale: 3 }),
    syncErrorMs: integer("sync_error_ms"),
    status: text("status").notNull().default("PROVISIONAL"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    capturedAt: createdAt(),
    revision: integer("revision").notNull().default(1),
  },
  (table) => ({
    oneResultPerProof: uniqueIndex("zero3_result_proof_registration_unique").on(
      table.eventId,
      table.proofId,
      table.registrationId,
    ),
  }),
);

export const zero3ResultRevisionsTable = pgTable("zero3_result_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resultId: uuid("result_id")
    .notNull()
    .references(() => zero3ResultsTable.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status").notNull(),
  previousElapsedMs: integer("previous_elapsed_ms"),
  previousRawValue: numeric("previous_raw_value", { precision: 12, scale: 3 }),
  reason: text("reason").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: createdAt(),
});

export const zero3TimersTable = pgTable("zero3_timers", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
  state: text("state").notNull().default("IDLE"),
  elapsedMs: integer("elapsed_ms").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  preparationEndsAt: timestamp("preparation_ends_at", { withTimezone: true }),
  version: integer("version").notNull().default(0),
  lastCommandId: text("last_command_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const zero3PodiumsTable = pgTable(
  "zero3_podium_versions",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => zero3EventsTable.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    registrationIds: jsonb("registration_ids")
      .$type<Array<string | null>>()
      .notNull(),
    published: boolean("published").notNull().default(false),
    publishedBy: text("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishReason: text("publish_reason"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.eventId, table.category, table.version],
    }),
  }),
);

export const zero3MembersTable = pgTable("zero3_members", {
  email: text("email").primaryKey(),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const zero3EventDeletionAuditTable = pgTable(
  "zero3_event_deletion_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    eventName: text("event_name").notNull(),
    actorId: text("actor_id").notNull(),
    backupDigest: text("backup_digest").notNull(),
    recordCounts: jsonb("record_counts").$type<Record<string, number>>().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIndex: index("zero3_event_deletion_audit_event_idx").on(
      table.eventId,
      table.deletedAt,
    ),
  }),
);
