-- Add messagesSnapshot column with default empty array for existing rows
ALTER TABLE "Checkpoint" ADD COLUMN "messagesSnapshot" JSONB NOT NULL DEFAULT '[]';

-- Backfill existing checkpoints from conversation.json if possible,
-- otherwise they keep the empty array default.
-- Remove the default after migration so future inserts must provide a value.
ALTER TABLE "Checkpoint" ALTER COLUMN "messagesSnapshot" DROP DEFAULT;
