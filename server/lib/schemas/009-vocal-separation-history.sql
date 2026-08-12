-- Up
CREATE TABLE IF NOT EXISTS "vocalSeparationHistory" (
  "mediaId" INTEGER PRIMARY KEY REFERENCES media(mediaId) ON DELETE CASCADE,
  "source" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" INTEGER,
  "completedAt" INTEGER,
  "audioSeconds" REAL,
  "processingSeconds" REAL,
  "error" TEXT
);

CREATE INDEX IF NOT EXISTS "vocalSeparationHistoryCompletedAt"
  ON "vocalSeparationHistory" ("completedAt" DESC);

-- Down
DROP INDEX IF EXISTS "vocalSeparationHistoryCompletedAt";
DROP TABLE IF EXISTS "vocalSeparationHistory";
