-- Up
ALTER TABLE "media" ADD COLUMN "isManagedDownload" INTEGER NOT NULL DEFAULT(0);

-- Down
ALTER TABLE "media" DROP COLUMN "isManagedDownload";
