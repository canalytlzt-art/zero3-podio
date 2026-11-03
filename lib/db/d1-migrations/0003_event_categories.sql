-- Event categories are configured per event. Existing events default to both
-- supported categories; SQLite stores this JSON array as validated text.
ALTER TABLE zero3_events
  ADD COLUMN categories TEXT NOT NULL DEFAULT '["SC","RX"]'
  CHECK (json_valid(categories));
