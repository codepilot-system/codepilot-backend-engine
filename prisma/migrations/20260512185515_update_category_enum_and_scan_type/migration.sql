/*
  Warnings:

  - The values [FUNCTIONALITY,OTHER] on the enum `Category` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('REPO', 'LOCAL');

-- AlterEnum
BEGIN;
CREATE TYPE "Category_new" AS ENUM ('CODE_SMELL', 'DEAD_CODE', 'DUPLICATE', 'COMPLEXITY', 'SRP_VIOLATION', 'SECURITY', 'PERFORMANCE');
ALTER TABLE "issues" ALTER COLUMN "category" TYPE "Category_new" USING ("category"::text::"Category_new");
ALTER TYPE "Category" RENAME TO "Category_old";
ALTER TYPE "Category_new" RENAME TO "Category";
DROP TYPE "public"."Category_old";
COMMIT;

-- AlterTable
ALTER TABLE "scans" ADD COLUMN     "scan_type" "ScanType" NOT NULL DEFAULT 'REPO';
