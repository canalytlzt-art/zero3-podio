-- Bind application roles to the Clerk subject verified by the backend.
ALTER TABLE zero3_members ADD COLUMN clerk_user_id TEXT;
CREATE UNIQUE INDEX zero3_members_clerk_user_id_unique
  ON zero3_members(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
