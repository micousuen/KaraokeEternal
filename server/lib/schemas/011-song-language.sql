-- Up
ALTER TABLE "songs" ADD COLUMN "language" TEXT;

CREATE INDEX IF NOT EXISTS "idxSongsLanguage" ON "songs" ("language");

-- Down
DROP INDEX IF EXISTS "idxSongsLanguage";
ALTER TABLE "songs" DROP COLUMN "language";
