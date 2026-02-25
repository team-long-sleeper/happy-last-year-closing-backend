/*
  Warnings:

  - The values [KAKAO,GOOGLE] on the enum `OAuthProvider` will be removed. If these variants are still used in the database, this will fail.
  - Made the column `isDefaultImage` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OAuthProvider_new" AS ENUM ('kakao', 'google');
ALTER TABLE "OAuthAccount" ALTER COLUMN "provider" TYPE "OAuthProvider_new" USING ("provider"::text::"OAuthProvider_new");
ALTER TYPE "OAuthProvider" RENAME TO "OAuthProvider_old";
ALTER TYPE "OAuthProvider_new" RENAME TO "OAuthProvider";
DROP TYPE "public"."OAuthProvider_old";
COMMIT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "isDefaultImage" SET NOT NULL;
