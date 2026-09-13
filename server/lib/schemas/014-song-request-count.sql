-- Up
ALTER TABLE "songs" ADD COLUMN "requestCount" INTEGER NOT NULL DEFAULT(0);

UPDATE "songs"
SET "requestCount" = (
  SELECT COUNT(*)
  FROM "queue"
  WHERE "queue"."songId" = "songs"."songId"
);

CREATE INDEX IF NOT EXISTS "idxSongsRequestCount" ON "songs" ("requestCount" DESC);

-- Down
DROP INDEX IF EXISTS "idxSongsRequestCount";
ALTER TABLE "songs" DROP COLUMN "requestCount";
