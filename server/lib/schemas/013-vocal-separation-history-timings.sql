-- Up
ALTER TABLE "vocalSeparationHistory" ADD COLUMN "vadSeconds" REAL;
ALTER TABLE "vocalSeparationHistory" ADD COLUMN "transcribeSeconds" REAL;
ALTER TABLE "vocalSeparationHistory" ADD COLUMN "alignSeconds" REAL;

-- Down
ALTER TABLE "vocalSeparationHistory" DROP COLUMN "vadSeconds";
ALTER TABLE "vocalSeparationHistory" DROP COLUMN "transcribeSeconds";
ALTER TABLE "vocalSeparationHistory" DROP COLUMN "alignSeconds";
