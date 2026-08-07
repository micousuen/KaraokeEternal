-- Up
ALTER TABLE "queue" ADD COLUMN "isPlayed" integer(1) NOT NULL DEFAULT(0);

CREATE INDEX IF NOT EXISTS idxQueuePlayed ON "queue" ("roomId", "isPlayed");

-- Down
DROP INDEX IF EXISTS idxQueuePlayed;

ALTER TABLE "queue" DROP COLUMN "isPlayed";
