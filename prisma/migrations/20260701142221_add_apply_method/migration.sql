-- CreateEnum
CREATE TYPE "ApplyMethod" AS ENUM ('AI', 'STATIC');

-- AlterTable
ALTER TABLE "suggestion_apply_items" ADD COLUMN     "apply_method" "ApplyMethod";
