/*
  Warnings:

  - You are about to drop the column `profileImage` on the `Contact` table. All the data in the column will be lost.
  - You are about to drop the column `groupName` on the `ContactGroup` table. All the data in the column will be lost.
  - Added the required column `name` to the `ContactGroup` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "profileImage",
ADD COLUMN     "image" TEXT;

-- AlterTable
ALTER TABLE "ContactGroup" DROP COLUMN "groupName",
ADD COLUMN     "name" TEXT NOT NULL;
