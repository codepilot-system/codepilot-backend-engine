/*
  Warnings:

  - Made the column `scan_id` on table `issues` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_scan_id_fkey";

-- DropForeignKey
ALTER TABLE "scans" DROP CONSTRAINT "scans_initiator_id_fkey";

-- AlterTable
ALTER TABLE "issues" ALTER COLUMN "scan_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "scans" ALTER COLUMN "initiator_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
