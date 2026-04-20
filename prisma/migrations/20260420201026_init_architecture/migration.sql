-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'FIXED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPLIED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('SECURITY', 'PERFORMANCE', 'FUNCTIONALITY', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "github_id" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "last_scan_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "initiator_id" INTEGER NOT NULL,
    "branch_name" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "scan_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "scan_id" INTEGER,
    "file_path" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "severity" "Severity" NOT NULL,
    "category" "Category" NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "code_snippet" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "scan_id" INTEGER NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "explanation" TEXT,
    "diff_patch" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "scan_id" INTEGER NOT NULL,
    "avg_complexity" DOUBLE PRECISION NOT NULL,
    "technical_debt_score" INTEGER NOT NULL,
    "severity_distribution" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_github_id_key" ON "users"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "projects_repo_url_key" ON "projects"("repo_url");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
