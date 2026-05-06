/*
  Warnings:

  - Made the column `color` on table `Tag` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Tag" ALTER COLUMN "color" SET NOT NULL;
