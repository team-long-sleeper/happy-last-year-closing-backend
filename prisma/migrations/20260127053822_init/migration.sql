/*
  Warnings:

  - You are about to drop the column `providerUserId` on the `OAuthAccount` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "OAuthAccount" DROP COLUMN "providerUserId";
