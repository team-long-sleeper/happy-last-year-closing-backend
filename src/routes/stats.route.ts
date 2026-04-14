import { prisma } from '@lib/prisma.js';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { episodePictureUrl } from '../constants/paths.js';

const router = express.Router();

/**
 * GET /stats
 *
 * Query params:
 *   startDate   ISO date string  e.g. 2024-01-01
 *   endDate     ISO date string  e.g. 2024-12-31
 *   contactIds  comma-separated contact UUIDs
 *   placeIds    comma-separated place ints
 *   tagIds      comma-separated tag ints
 */

router.get('', requireAuth, async (req, res) => {
  try {
    const userId = req.auth!.userId;
    const { startDate, endDate, contactIds, placeIds, tagIds } = req.query;

    const parsedContactIds = contactIds
      ? (contactIds as string).split(',').map((s) => s.trim())
      : undefined;
    const parsedPlaceIds = placeIds
      ? (placeIds as string).split(',').map((s) => parseInt(s.trim(), 10))
      : undefined;
    const parsedTagIds = tagIds
      ? (tagIds as string).split(',').map((s) => parseInt(s.trim(), 10))
      : undefined;

    const episodeWhere = {
      ownerUserId: userId,
      ...(startDate || endDate
        ? {
            date: {
              ...(startDate && { gte: new Date(startDate as string) }), // gte Greater Than or Equal (이 날 이후)
              ...(endDate && { lte: new Date(endDate as string) }), // lte Less Than or Equal (이 날 이전 )
            },
          }
        : {}),
      ...(parsedPlaceIds?.length ? { placeId: { in: parsedPlaceIds } } : {}),
      ...(parsedContactIds?.length
        ? { mates: { some: { contactId: { in: parsedContactIds } } } }
        : {}),
      ...(parsedTagIds?.length ? { tags: { some: { tagId: { in: parsedTagIds } } } } : {}),
    };

    const [allEpisodeDates, uniquePlaces, uniqueContacts] = await Promise.all([
      prisma.episode.findMany({
        where: episodeWhere,
        select: { date: true },
      }),
      prisma.episode.groupBy({
        by: ['placeId'],
        where: episodeWhere,
        _count: true,
      }),
      prisma.episodeMate.groupBy({
        by: ['contactId'],
        where: { episode: episodeWhere },
        _count: true,
      }),
    ]);

    const totalEpisodes = allEpisodeDates.length;
    const monthSet = new Set(
      allEpisodeDates.map((e) => {
        const d = new Date(e.date);
        return `${d.getFullYear()}-${d.getMonth()}`;
      }),
    );
    const monthlyAverage =
      monthSet.size > 0 ? Math.round((totalEpisodes / monthSet.size) * 10) / 10 : 0;

    // top 5 contacts
    const topContactRows = await prisma.episodeMate.groupBy({
      by: ['contactId'],
      where: { episode: episodeWhere },
      _count: { episodeId: true },
      orderBy: { _count: { episodeId: 'desc' } },
      take: 5,
    });
    const topContactsRaw = await prisma.contact.findMany({
      where: { id: { in: topContactRows.map((r) => r.contactId) } },
      select: { id: true, name: true, profileImage: true },
    });
    const contactCountMap = new Map(topContactRows.map((r) => [r.contactId, r._count.episodeId]));
    const contactMap = new Map(topContactsRaw.map((c) => [c.id, c]));
    const topContacts = topContactRows.map((r) => contactMap.get(r.contactId)!).filter(Boolean);

    // top 5 places
    const topPlaceRows = await prisma.episode.groupBy({
      by: ['placeId'],
      where: episodeWhere,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });
    const topPlacesRaw = await prisma.place.findMany({
      where: { id: { in: topPlaceRows.map((r) => r.placeId) } },
      select: { id: true, name: true, address: true, thumbnailUrl: true },
    });
    const placeCountMap = new Map(topPlaceRows.map((r) => [r.placeId, r._count.id]));
    const placeMap = new Map(topPlacesRaw.map((p) => [p.id, p]));
    const topPlaces = topPlaceRows.map((r) => placeMap.get(r.placeId)!).filter(Boolean);

    // top 5 tags
    const topTagRows = await prisma.episodeTag.groupBy({
      by: ['tagId'],
      where: { episode: episodeWhere },
      _count: { episodeId: true },
      orderBy: { _count: { episodeId: 'desc' } },
      take: 5,
    });
    const topTagsRaw = await prisma.tag.findMany({
      where: { id: { in: topTagRows.map((r) => r.tagId) } },
      select: { id: true, label: true },
    });
    const tagCountMap = new Map(topTagRows.map((r) => [r.tagId, r._count.episodeId]));
    const tagMap = new Map(topTagsRaw.map((t) => [t.id, t]));
    const topTags = topTagRows.map((r) => tagMap.get(r.tagId)!).filter(Boolean);

    // 각 태그의 가장 최신 에피소드의 첫 번째 이미지 (복호화 프록시 URL 사용)
    const tagThumbnailMap = new Map<number, { id: number; order: number; url: string } | null>();
    await Promise.all(
      topTagRows.map(async (r) => {
        const latestEpisodeTag = await prisma.episodeTag.findFirst({
          where: { tagId: r.tagId, episode: episodeWhere },
          orderBy: { episode: { date: 'desc' } },
          include: {
            episode: {
              include: {
                pictures: { orderBy: { order: 'asc' }, take: 1 },
              },
            },
          },
        });
        const picture = latestEpisodeTag?.episode.pictures[0];
        tagThumbnailMap.set(
          r.tagId,
          picture
            ? { id: picture.id, order: picture.order, url: episodePictureUrl(picture.id) }
            : null,
        );
      }),
    );

    return res.status(200).json({
      summary: {
        totalEpisodes,
        uniquePlaces: uniquePlaces.length,
        uniqueContacts: uniqueContacts.length,
        monthlyAverage,
      },
      topContacts: topContacts.map((c) => ({
        contact: c,
        episodeCount: contactCountMap.get(c.id) ?? 0,
      })),
      topPlaces: topPlaces.map((p) => ({
        place: p,
        episodeCount: placeCountMap.get(p.id) ?? 0,
      })),
      topTags: topTags.map((t) => ({
        tag: t,
        episodeCount: tagCountMap.get(t.id) ?? 0,
        thumbnail: tagThumbnailMap.get(t.id) ?? null,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
