/*
  Warnings:

  - The values [OWNER] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - The `provider` column on the `projects` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[scan_id]` on the table `analytics` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[provider,github_repo_id]` on the table `projects` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `github_repo_id` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `owner` to the `projects` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repo_name` to the `projects` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GITHUB');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Category" ADD VALUE 'FUNCTIONALITY';
ALTER TYPE "Category" ADD VALUE 'OTHER';

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'MEMBER');
ALTER TABLE "public"."project_members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "project_members" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
ALTER TABLE "project_members" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
COMMIT;

-- DropIndex
DROP INDEX "projects_repo_url_key";

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "github_repo_id" BIGINT NOT NULL,
ADD COLUMN     "installation_id" INTEGER,
ADD COLUMN     "owner" TEXT NOT NULL,
ADD COLUMN     "repo_name" TEXT NOT NULL,
DROP COLUMN "provider",
ADD COLUMN     "provider" "Provider" NOT NULL DEFAULT 'GITHUB';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "github_refresh_token" TEXT,
ADD COLUMN     "github_token_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "analytics_project_id_idx" ON "analytics"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_scan_id_key" ON "analytics"("scan_id");

-- CreateIndex
CREATE INDEX "issues_scan_id_idx" ON "issues"("scan_id");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_provider_github_repo_id_key" ON "projects"("provider", "github_repo_id");

-- CreateIndex
CREATE INDEX "scans_project_id_idx" ON "scans"("project_id");

-- CreateIndex
CREATE INDEX "suggestions_issue_id_idx" ON "suggestions"("issue_id");
