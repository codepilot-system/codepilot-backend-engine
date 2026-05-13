/*
  Warnings:

  - You are about to drop the column `scan_type` on the `scans` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "scans" DROP COLUMN "scan_type";

-- DropEnum
DROP TYPE "ScanType";
