/*
  Warnings:

  - You are about to drop the column `providerUserid` on the `OAuthAccount` table. All the data in the column will be lost.
  - Added the required column `providerUserId` to the `OAuthAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `lastLoginAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OAuthAccount" DROP COLUMN "providerUserid",
ADD COLUMN     "providerUserId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3) NOT NULL;
