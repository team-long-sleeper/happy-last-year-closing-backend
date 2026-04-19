import { prisma } from '@lib/prisma.js';
import express from 'express';
import { z, flattenError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../utils/r2.js';
import { decryptBuffer } from '../lib/security/crypto.js';
import { fetchAndUploadPlaceThumbnail } from '../utils/placeThumbnail.js';
import { episodePictureUrl } from '../constants/paths.js';

const router = express.Router();

const Place = z.object({
  providerId: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  url: z.httpUrl(),
});

type PlaceType = z.infer<typeof Place>;

const Picture = z.object({
  key: z.string(),
  iv: z.string(),
  order: z.number(),
});

const CreateBody = z.object({
  title: z.string().min(1),
  date: z.iso.datetime(),
  matesId: z.array(z.string()).default([]),
  place: Place,
  pictures: z.array(Picture).min(1).max(5),
  tags: z.array(z.string()).default([]),
  memo: z.string().max(150),
});

const UpdatePicture = z.discriminatedUnion('type', [
  z.object({ type: z.literal('new'), key: z.string(), iv: z.string(), order: z.number() }),
  z.object({ type: z.literal('exists'), id: z.number(), order: z.number() }),
]);

const UpdateBody = CreateBody.extend({
  deletedPictureId: z.array(z.number()).optional(),
  pictures: z.array(UpdatePicture).min(1).max(5),
});

router.post('', requireAuth, async (req, res) => {
  const { userId: ownerUserId } = req.auth!;

  const parsed = CreateBody.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Inavlid Body', errors: flattenError(parsed.error) });
  }

  const { title, date, matesId, place, pictures, memo, tags } = parsed.data;

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

  const uniqueTagLabels = [...new Set(tags)];

  let thumbnailUrl: string | null = null;

  const existingPlace = await prisma.place.findUnique({
    where: { providerId: place.providerId },
    select: { thumbnailUrl: true },
  });

  if (existingPlace) {
    // 이미 저장된 장소 → 기존 썸네일 그대로 사용
    thumbnailUrl = existingPlace.thumbnailUrl;
  } else {
    // 새 장소 → Google Places에서 썸네일 가져오기
    thumbnailUrl = await fetchAndUploadPlaceThumbnail({
      placeName: place.name,
      lat: place.lat,
      lng: place.lng,
      providerId: place.providerId,
    });
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
        ...(thumbnailUrl !== null && { thumbnailUrl }),
      },
      create: {
        providerId: place.providerId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        url: place.url,
        thumbnailUrl,
      },
    });

    const created = await tx.episode.create({
      data: {
        ownerUserId,
        title,
        memo,
        date: new Date(date),
        placeId: newPlace.id,
        mates: {
          create: uniqueMateIds.map((contactId) => ({ contact: { connect: { id: contactId } } })),
        },
      },
    });

    if (uniqueTagLabels.length > 0) {
      const upsertedTags = await Promise.all(
        uniqueTagLabels.map((label) =>
          tx.tag.upsert({
            where: { ownerUserId_label: { ownerUserId, label } },
            update: {},
            create: { label, ownerUserId },
            select: { id: true },
          }),
        ),
      );
      await tx.episodeTag.createMany({
        data: upsertedTags.map((t) => ({ episodeId: created.id, tagId: t.id })),
      });
    }

    await tx.episodePicture.createMany({
      data: pictures.map((p) => ({
        episodeId: created.id,
        key: p.key,
        iv: p.iv,
        order: p.order,
      })),
    });

    return created;
  });

  return res.status(201).json({ id: episode.id });
});

router.get('', requireAuth, async (req, res) => {
  const { userId: ownerUserId } = req.auth!;
  const { startDate, endDate, contactIds, placeIds, tagIds, cursor, limit } = req.query;

  const take = Math.min(Number(limit) || 20, 50);
  const cursorId = cursor ? Number(cursor) : undefined;

  const parsedContactIds = contactIds
    ? (contactIds as string).split(',').map((s) => s.trim())
    : undefined;
  const parsedPlaceIds = placeIds
    ? (placeIds as string).split(',').map((s) => parseInt(s.trim(), 10))
    : undefined;
  const parsedTagIds = tagIds
    ? (tagIds as string).split(',').map((s) => parseInt(s.trim(), 10))
    : undefined;

  const where = {
    ownerUserId,
    ...(startDate || endDate
      ? {
          date: {
            ...(startDate && { gte: new Date(startDate as string) }),
            ...(endDate && { lte: new Date(endDate as string) }),
          },
        }
      : {}),
    ...(parsedPlaceIds?.length ? { placeId: { in: parsedPlaceIds } } : {}),
    ...(parsedContactIds?.length
      ? { mates: { some: { contactId: { in: parsedContactIds } } } }
      : {}),
    ...(parsedTagIds?.length ? { tags: { some: { tagId: { in: parsedTagIds } } } } : {}),
  };

  const episodes = await prisma.episode.findMany({
    where,
    orderBy: { date: 'desc' },
    take: take + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: {
      pictures: { orderBy: { order: 'asc' } },
      place: true,
      tags: {
        include: {
          tag: {
            select: {
              color: true,
              label: true,
            },
          },
        },
      },
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

  const hasNext = episodes.length > take;
  if (hasNext) episodes.pop();

  const items = episodes.map((ep) => ({
    id: ep.id,
    title: ep.title,
    memo: ep.memo,
    date: ep.date,
    mates: ep.mates.map((m) => m.contact),
    place: ep.place,
    tags: ep.tags.map((t) => ({
      label: t.tag.label,
      color: t.tag.color,
      id: t.tagId,
    })),
    pictures: ep.pictures.map((p) => ({
      id: p.id,
      order: p.order,
      url: episodePictureUrl(p.id),
    })),
  }));

  const nextCursor = hasNext ? items[items.length - 1]?.id : null;

  return res.status(200).json({ episodes: items, nextCursor });
});

router.get('/pictures/:pictureId', requireAuth, async (req, res) => {
  const { userId: ownerUserId } = req.auth!;
  const pictureId = Number(req.params.pictureId);
  if (!Number.isInteger(pictureId)) return res.status(400).json({ message: 'Invalid Id' });

  const picture = await prisma.episodePicture.findUnique({
    where: { id: pictureId },
    select: { key: true, iv: true, episode: { select: { ownerUserId: true } } },
  });

  if (!picture || picture.episode.ownerUserId !== ownerUserId) {
    return res.status(404).json({ message: 'Not found' });
  }

  if (!picture.iv) {
    return res.status(422).json({ message: 'Image is not encrypted' });
  }

  const r2Res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: picture.key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of r2Res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const encrypted = Buffer.concat(chunks);
  const plain = decryptBuffer(encrypted, picture.iv);

  const ext = picture.key.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
  };
  const contentType = (ext && mimeMap[ext]) ?? 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  return res.send(plain);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { userId: ownerUserId } = req.auth!;
  const episodeId = Number(req.params.id);
  if (!Number.isInteger(episodeId)) return res.status(400).json({ message: 'Invalid Id' });

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, ownerUserId },
    include: {
      pictures: { orderBy: { order: 'asc' } },
      place: { omit: { createdAt: true, id: true } },
      tags: {
        include: {
          tag: {
            select: {
              label: true,
              color: true,
            },
          },
        },
      },
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

  const pictures = episode.pictures.map((p) => ({
    id: p.id,
    order: p.order,
    url: `/episodes/pictures/${p.id}`,
  }));

  return res.json({
    id: episode.id,
    title: episode.title,
    memo: episode.memo,
    date: episode.date,
    pictures,
    createdAt: episode.createdAt,
    mates: episode.mates.map((m) => m.contact),
    place: episode.place,
    tags: episode.tags.map((t) => {
      return { label: t.tag.label, color: t.tag.color, id: t.tagId };
    }),
  });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const episodeId = Number(req.params.id);
  if (!Number.isInteger(episodeId)) return res.status(400).json({ message: 'Invalid Id' });

  await prisma.episode.delete({
    where: { ownerUserId: userId, id: episodeId },
  });

  return res.status(204).send();
});

router.patch('/:id', requireAuth, async (req, res) => {
  const { userId } = req.auth!;
  const episodeId = Number(req.params.id);

  const parsed = UpdateBody.safeParse(req.body);

  if (!parsed.success)
    return res.status(400).json({ message: 'Inavlid Body', errors: flattenError(parsed.error) });

  const { title, date, matesId, place, pictures, deletedPictureId, memo, tags } = parsed.data;
  const uniqueMateIds = [...new Set(matesId)];
  const uniqueTagLabels = [...new Set(tags)];

  const episodeExists = await prisma.episode.findUnique({
    where: { ownerUserId: userId, id: episodeId },
  });

  if (!episodeExists)
    return res.status(404).json({ message: '해당하는 에피소드가 존재하지 않습니다.' });

  let thumbnailUrl: string | null = null;

  const existingPlace = await prisma.place.findUnique({
    where: { providerId: place.providerId },
    select: { thumbnailUrl: true },
  });

  if (existingPlace) {
    // 이미 저장된 장소 → 기존 썸네일 그대로 사용
    thumbnailUrl = existingPlace.thumbnailUrl;
  } else {
    // 새 장소 → Google Places에서 썸네일 가져오기
    thumbnailUrl = await fetchAndUploadPlaceThumbnail({
      placeName: place.name,
      lat: place.lat,
      lng: place.lng,
      providerId: place.providerId,
    });
  }

  const updateEpisode = await prisma.$transaction(async (tx) => {
    const placeUpdate = await tx.place.upsert({
      where: { providerId: place.providerId },
      update: {
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        url: place.url,
        ...(thumbnailUrl !== null && { thumbnailUrl }),
      },
      create: {
        providerId: place.providerId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        url: place.url,
        thumbnailUrl,
      },
    });

    const episode = await tx.episode.update({
      where: { id: episodeId, ownerUserId: userId },
      data: {
        ownerUserId: userId,
        title,
        memo,
        date: new Date(date),
        placeId: placeUpdate.id,
        mates: {
          // 기존에 에피소드에 연결된 친구 전부 삭제
          deleteMany: {},
          create: uniqueMateIds.map((contactId) => ({ contact: { connect: { id: contactId } } })),
        },
      },
    });

    await tx.episodeTag.deleteMany({ where: { episodeId } });
    if (uniqueTagLabels.length > 0) {
      const upsertedTags = await Promise.all(
        uniqueTagLabels.map((label) =>
          tx.tag.upsert({
            where: { ownerUserId_label: { ownerUserId: userId, label } },
            update: {},
            create: { label, ownerUserId: userId },
            select: { id: true },
          }),
        ),
      );
      await tx.episodeTag.createMany({
        data: upsertedTags.map((t) => ({ episodeId, tagId: t.id })),
      });
    }

    if (deletedPictureId)
      await tx.episodePicture.deleteMany({
        where: { id: { in: deletedPictureId } },
      });

    await tx.episodePicture.createMany({
      data: pictures
        .filter((pic) => pic.type === 'new')
        .map((pic) => ({
          episodeId: episode.id,
          key: pic.key,
          iv: pic.iv,
          order: pic.order,
        })),
    });

    return episode;
  });

  return res.status(200).json({ id: updateEpisode.id });
});

export default router;
