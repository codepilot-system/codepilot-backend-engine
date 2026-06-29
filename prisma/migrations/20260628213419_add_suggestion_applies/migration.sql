-- CreateEnum
CREATE TYPE "SuggestionsApplyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionsApplyItemStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "suggestion_applies" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "scan_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "branch_name" TEXT,
    "pr_url" TEXT,
    "status" "SuggestionsApplyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "suggestion_applies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_apply_items" (
    "id" SERIAL NOT NULL,
    "suggestion_apply_id" INTEGER NOT NULL,
    "suggestion_id" INTEGER NOT NULL,
    "status" "SuggestionsApplyItemStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,

    CONSTRAINT "suggestion_apply_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestion_applies_project_id_idx" ON "suggestion_applies"("project_id");

-- CreateIndex
CREATE INDEX "suggestion_applies_status_created_at_idx" ON "suggestion_applies"("status", "created_at");

-- CreateIndex
CREATE INDEX "suggestion_apply_items_suggestion_id_idx" ON "suggestion_apply_items"("suggestion_id");

-- CreateIndex
CREATE UNIQUE INDEX "suggestion_apply_items_suggestion_apply_id_suggestion_id_key" ON "suggestion_apply_items"("suggestion_apply_id", "suggestion_id");

-- AddForeignKey
ALTER TABLE "suggestion_applies" ADD CONSTRAINT "suggestion_applies_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_applies" ADD CONSTRAINT "suggestion_applies_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_applies" ADD CONSTRAINT "suggestion_applies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_apply_items" ADD CONSTRAINT "suggestion_apply_items_suggestion_apply_id_fkey" FOREIGN KEY ("suggestion_apply_id") REFERENCES "suggestion_applies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_apply_items" ADD CONSTRAINT "suggestion_apply_items_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
