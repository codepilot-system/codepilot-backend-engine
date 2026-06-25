-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "installation_id" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "github_id" TYPE BIGINT USING "github_id"::bigint;

-- CreateIndex
CREATE UNIQUE INDEX "projects_github_repo_id_key" ON "projects"("github_repo_id");
