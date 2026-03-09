import { prisma } from '@lib/prisma.js';
import express from 'express';
import z, { flattenError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../utils/r2.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const router = express.Router();

const Place = z.object({
  providerId: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  url: z.string(),
});

const CreateBody = z.object({
  title: z.string().min(1),
  date: z.iso.datetime(),
  matesId: z.array(z.string()).default([]),
  place: Place,
  coverIndex: z.number().int().nonnegative(),
  pictureKeys: z.array(z.string().min(1)).min(1).max(50),
});

// 1 create episode

router.post('', requireAuth, async (req, res) => {
  try {
    const { userId: ownerUserId } = req.auth!;

    const parsed = CreateBody.safeParse(req.body);

    console.log(parsed);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Inavlid Body', errors: flattenError(parsed.error) });
    }

    const { title, date, matesId, place, coverIndex, pictureKeys } = parsed.data;

    if (coverIndex < 0 || coverIndex >= pictureKeys.length) {
      return res.status(400).json({ message: 'coverIndex out of range' });
    }

    const indices = [...Array(pictureKeys.length).keys()];
    const ordered = [coverIndex, ...indices.filter((i) => i !== coverIndex)];
    const pictureRows = ordered.map((pictureIndex, orderIndex) => ({
      key: pictureKeys[pictureIndex]!,
      order: orderIndex + 1,
    }));

    const episode = await prisma.$transaction(async (tx) => {
      const newPlace = await tx.place.upsert({
        where: { providerPlaceId: place.providerId },
        update: {
          name: place.name,
        },
        create: {
          providerPlaceId: place.providerId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
        },
      });

      const created = await tx.episode.create({
        data: {
          ownerUserId,
          title,
          date: new Date(date),
          matesId,
          placeId: newPlace.id,
        },
      });

      await tx.episodePicture.createMany({
        data: pictureRows.map((p) => ({
          episodeId: created.id,
          key: p.key,
          order: p.order,
        })),
      });

      return created;
    });

    return res.status(201).json({ id: episode.id });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: 'internal server error' });
  }
});

router.get('', requireAuth, async (req, res) => {
  try {
    const { userId: ownerUserId } = req.auth!;

    const episodes = await prisma.episode.findMany({
      where: {
        ownerUserId,
      },
      orderBy: { date: 'desc' },
      include: {
        pictures: { where: { order: 1 }, take: 1 },
      },
    });

    const items = await Promise.all(
      episodes.map(async (ep) => {
        const cover = ep.pictures[0];
        let coverUrl: string | null = null;

        if (cover) {
          const cmd = new GetObjectCommand({
            Bucket: R2_BUCKET,
            Key: cover.key,
          });
          coverUrl = await getSignedUrl(r2, cmd, { expiresIn: 60 * 5 });
        }

        return {
          id: ep.id,
          title: ep.title,
          date: ep.date,
          matesId: ep.matesId,
          placeId: ep.placeId,
          coverUrl,
          createdAt: ep.createdAt,
        };
      }),
    );

    return res.status(200).json({ episodes: items });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { userId: ownerUserId } = req.auth!;

    const episodeId = Number(req.params.id);
    if (!Number.isFinite(episodeId)) return res.status(400).json({ message: 'Invalid Id' });

    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, ownerUserId },
      include: { pictures: { orderBy: { order: 'asc' } } },
    });

    if (!episode) return res.status(404).json({ message: 'not found' });

    const pictures = await Promise.all(
      episode.pictures.map(async (p) => {
        const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: p.key });

        // 왜 getsinged url 을 주는거지? get인데? 왜 제한시간을 주는거지?
        const url = await getSignedUrl(r2, cmd, { expiresIn: 60 * 5 });
        return { id: p.id, order: p.order, url };
      }),
    );

    return res.json({
      id: episode.id,
      title: episode.title,
      date: episode.date,
      matesId: episode.matesId,
      placeId: episode.placeId,
      coverUrl: pictures[0]?.url ?? null,
      pictures,
      createdAt: episode.createdAt,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: 'internal server error' });
  }
});

export default router;
