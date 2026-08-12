-- Up
CREATE TABLE IF NOT EXISTS "audioTrackAnalysis" (
  "mediaId" INTEGER PRIMARY KEY REFERENCES media(mediaId) ON DELETE CASCADE,
  "audioTrackCount" INTEGER NOT NULL,
  "ktvTrack" INTEGER,
  "confidence" REAL NOT NULL DEFAULT(0),
  "sourceSize" INTEGER NOT NULL,
  "sourceMtimeMs" REAL NOT NULL,
  "dateAnalyzed" INTEGER NOT NULL
);

-- Down
DROP TABLE IF EXISTS "audioTrackAnalysis";
