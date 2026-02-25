/*
  Warnings:

  - You are about to drop the column `profile_image_url` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[provider,providerUserId]` on the table `OAuthAccount` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `providerUserId` to the `OAuthAccount` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `OAuthAccount` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "OAuthAccount" DROP CONSTRAINT "OAuthAccount_id_fkey";

-- AlterTable
ALTER TABLE "OAuthAccount" ADD COLUMN     "providerUserId" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "profile_image_url",
ADD COLUMN     "isDefaultImage" BOOLEAN,
ADD COLUMN     "profileImge" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_key" ON "OAuthAccount"("provider", "providerUserId");

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
