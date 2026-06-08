/*
  Warnings:

  - You are about to drop the column `contactGroupId` on the `Contact` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_contactGroupId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "contactGroupId";

-- CreateTable
CREATE TABLE "ContactGroupMember" (
    "contactId" TEXT NOT NULL,
    "contactGroupId" TEXT NOT NULL,

    CONSTRAINT "ContactGroupMember_pkey" PRIMARY KEY ("contactGroupId","contactId")
);

-- CreateIndex
CREATE INDEX "ContactGroupMember_contactId_idx" ON "ContactGroupMember"("contactId");

-- AddForeignKey
ALTER TABLE "ContactGroupMember" ADD CONSTRAINT "ContactGroupMember_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactGroupMember" ADD CONSTRAINT "ContactGroupMember_contactGroupId_fkey" FOREIGN KEY ("contactGroupId") REFERENCES "ContactGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
