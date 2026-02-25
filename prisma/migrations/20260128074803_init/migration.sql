/*
  Warnings:

  - The values [kakao,google] on the enum `OAuthProvider` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OAuthProvider_new" AS ENUM ('KAKAO', 'GOOGLE');
ALTER TABLE "OAuthAccount" ALTER COLUMN "provider" TYPE "OAuthProvider_new" USING ("provider"::text::"OAuthProvider_new");
ALTER TYPE "OAuthProvider" RENAME TO "OAuthProvider_old";
ALTER TYPE "OAuthProvider_new" RENAME TO "OAuthProvider";
DROP TYPE "public"."OAuthProvider_old";
COMMIT;
