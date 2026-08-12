-- Up
ALTER TABLE "audioTrackAnalysis" ADD COLUMN "duration" REAL NOT NULL DEFAULT(0);
ALTER TABLE "audioTrackAnalysis" ADD COLUMN "scriptReady" INTEGER NOT NULL DEFAULT(0);

-- Down
ALTER TABLE "audioTrackAnalysis" DROP COLUMN "scriptReady";
ALTER TABLE "audioTrackAnalysis" DROP COLUMN "duration";
