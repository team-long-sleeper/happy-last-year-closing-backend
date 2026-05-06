-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeTag" (
    "episodeId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "EpisodeTag_pkey" PRIMARY KEY ("episodeId","tagId")
);

-- CreateIndex
CREATE INDEX "Tag_ownerUserId_idx" ON "Tag"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_ownerUserId_name_key" ON "Tag"("ownerUserId", "name");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTag" ADD CONSTRAINT "EpisodeTag_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeTag" ADD CONSTRAINT "EpisodeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
