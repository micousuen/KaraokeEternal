-- Up
CREATE TABLE IF NOT EXISTS "mediaMetadataAnalysis" (
  "mediaId" INTEGER PRIMARY KEY REFERENCES media(mediaId) ON DELETE CASCADE,
  "sourceSize" INTEGER NOT NULL,
  "sourceMtimeMs" REAL NOT NULL,
  "dateAnalyzed" INTEGER NOT NULL
);

-- Down
DROP TABLE IF EXISTS "mediaMetadataAnalysis";
