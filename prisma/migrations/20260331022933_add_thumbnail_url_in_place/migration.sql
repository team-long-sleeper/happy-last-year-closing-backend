/*
  Warnings:

  - Made the column `thumbnailUrl` on table `Place` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Place" ALTER COLUMN "thumbnailUrl" SET NOT NULL;
