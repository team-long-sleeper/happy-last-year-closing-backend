/*
  Warnings:

  - You are about to drop the column `name` on the `Tag` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ownerUserId,label]` on the table `Tag` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `label` to the `Tag` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Tag_ownerUserId_name_key";

-- AlterTable
ALTER TABLE "EpisodePicture" ADD COLUMN     "iv" TEXT;

-- AlterTable
ALTER TABLE "Tag" DROP COLUMN "name",
ADD COLUMN     "label" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_ownerUserId_label_key" ON "Tag"("ownerUserId", "label");
