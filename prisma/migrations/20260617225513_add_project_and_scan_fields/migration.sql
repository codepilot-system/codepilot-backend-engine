/*
  Warnings:

  - You are about to drop the column `description` on the `issues` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "issues" DROP COLUMN "description",
ADD COLUMN     "explanation" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "last_scanned_commit_sha" TEXT,
ADD COLUMN     "project_brief" TEXT,
ADD COLUMN     "project_summary" TEXT,
ADD COLUMN     "summary_generated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "scans" ADD COLUMN     "commit_sha" TEXT,
ADD COLUMN     "duration_ms" INTEGER,
ADD COLUMN     "model_used" TEXT,
ADD COLUMN     "tokens_used" INTEGER;
