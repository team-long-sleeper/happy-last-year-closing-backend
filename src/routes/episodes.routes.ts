import { prisma } from '@lib/prisma.js';
import express from 'express';
import { z, flattenError } from 'zod';
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

const Picture = z.object({
  key: z.string(),
  order: z.number(),
});

const CreateBody = z.object({
  title: z.string().min(1),
  date: z.iso.datetime(),
  matesId: z.array(z.string()).default([]),
  place: Place,
  pictures: z.array(Picture).min(1).max(5),
});

// 들어올 때 pictures에는 새 이미지들만 들어옴
const UpdateBody = CreateBody.extend({
  deletedPictureId: z.array(z.number()).optional(),
});

router.post('', requireAuth, async (req, res) => {
  try {
    const { userId: ownerUserId } = req.auth!;

    const parsed = CreateBody.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: 'Inavlid Body', errors: flattenError(parsed.error) });
    }

    const { title, date, matesId, place, pictures } = parsed.data;

    const uniqueMateIds = [...new Set(matesId)];
    const uniquePictureKeys = [...new Set(pictures.map((pic) => pic.key))];

    if (uniquePictureKeys.length !== pictures.length) {
      return res.status(400).json({ message: 'pictureKeys contains duplicates' });
    }

    if (uniqueMateIds.length > 0) {
      const contacts = await prisma.contact.findMany({
        where: {
          id: { in: uniqueMateIds },
          ownerUserId,
        },
        select: { id: true },
      });

      if (contacts.length !== uniqueMateIds.length) {
        return res
          .status(400)
          .json({ message: 'Some matesId are invalid or do not belong to this user' });
      }
    }

    const episode = await prisma.$transaction(async (tx) => {
      const newPlace = await tx.place.upsert({
        where: { providerId: place.providerId },
        // todo 장소가 업데이트되면 ProviderId도 바뀌나? 좌표는 안바뀔거아니야
        update: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          url: place.url,
        },
        create: {
          providerId: place.providerId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          url: place.url,
        },
      });

      const created = await tx.episode.create({
        data: {
          ownerUserId,
          title,
          date: new Date(date),
          placeId: newPlace.id,
          mates: {
            create: uniqueMateIds.map((contactId) => ({ contact: { connect: { id: contactId } } })),
          },
        },
      });

      await tx.episodePicture.createMany({
        data: pictures.map((p) => ({
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
      where: { ownerUserId },
      orderBy: { date: 'desc' },
      include: {
        pictures: { orderBy: { order: 'asc' } },
        place: true,
        mates: {
          include: {
            contact: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const items = await Promise.all(
      episodes.map(async (ep) => {
        const pictures = await Promise.all(
          ep.pictures.map(async (p) => {
            const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: p.key });
            const url = await getSignedUrl(r2, cmd, { expiresIn: 60 * 5 });
            return { id: p.id, order: p.order, url };
          }),
        );

        return {
          id: ep.id,
          title: ep.title,
          date: ep.date,
          mates: ep.mates.map((m) => m.contact),
          place: ep.place,
          pictures,
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
    if (!Number.isInteger(episodeId)) return res.status(400).json({ message: 'Invalid Id' });

    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, ownerUserId },
      include: {
        pictures: { orderBy: { order: 'asc' } },
        place: { omit: { createdAt: true, id: true } },
        mates: {
          include: {
            contact: {
              select: {
                profileImage: true,
                id: true,
                name: true,
                linkedUser: {
                  select: { profileImage: true },
                },
              },
            },
          },
        },
      },
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
      pictures,
      createdAt: episode.createdAt,
      mates: episode.mates.map((m) => m.contact),
      place: episode.place,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: 'internal server error' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { userId } = req.auth!;
    const episodeId = Number(req.params.id);

    await prisma.episode.delete({
      where: { ownerUserId: userId, id: episodeId },
    });

    return res.status(204).send();
  } catch (error) {
    console.log(error);
  }
});

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { userId } = req.auth!;
    const episodeId = Number(req.params.id);

    const parsed = UpdateBody.safeParse(req.body);

    if (!parsed.success)
      return res.status(400).json({ message: 'Inavlid Body', errors: flattenError(parsed.error) });

    const { title, date, matesId, place, pictures, deletedPictureId } = parsed.data;
    const uniqueMateIds = [...new Set(matesId)];

    const episodeExists = await prisma.episode.findUnique({
      where: { ownerUserId: userId, id: episodeId },
    });

    if (!episodeExists)
      return res.status(404).json({ message: '해당하는 에피소드가 존재하지 않습니다.' });

    const updateEpisode = await prisma.$transaction(async (tx) => {
      const placeUpdate = await tx.place.upsert({
        where: { providerId: place.providerId },
        update: {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          url: place.url,
        },
        create: {
          providerId: place.providerId,
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          url: place.url,
        },
      });

      const episode = await tx.episode.update({
        where: { id: episodeId, ownerUserId: userId },
        data: {
          ownerUserId: userId,
          title,
          date: new Date(date),
          placeId: placeUpdate.id,
          mates: {
            // 기존에 에피소드에 연결된 친구 전부 삭제
            deleteMany: {},
            create: uniqueMateIds.map((contactId) => ({ contact: { connect: { id: contactId } } })),
          },
        },
      });

      if (deletedPictureId)
        await tx.episodePicture.deleteMany({
          where: { id: { in: deletedPictureId } },
        });

      await tx.episodePicture.createMany({
        data: pictures.map((pic) => ({
          episodeId: episode.id,
          key: pic.key,
          order: pic.order,
        })),
      });

      return episode;
    });

    return res.status(200).json({ id: updateEpisode.id });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: 'internal server error while patch episode' });
  }
});

export default router;
