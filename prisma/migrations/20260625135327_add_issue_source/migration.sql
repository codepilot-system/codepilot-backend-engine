-- CreateEnum
CREATE TYPE "IssueSource" AS ENUM ('AI', 'ANALYZER');

-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "source" "IssueSource" NOT NULL DEFAULT 'ANALYZER';
