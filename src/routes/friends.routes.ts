import { prisma } from '@lib/prisma.js';
import express from 'express';
import { z, flattenError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { pickRandomDefaultProfileImage } from '../utils/defaultProfileImage.js';

const CreateContactBody = z.object({
  name: z.string().min(1).max(50),
});

const router = express.Router();

router.get('', requireAuth, async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { ownerUserId: req.auth!.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        profileImage: true,
        linkedUser: {
          select: {
            id: true,
            profileImage: true,
            oauthAccounts: {
              select: {
                provider: true,
              },
            },
          },
        },
      },
    });

    const dataResult = contacts.map((c) => ({
      id: c.id,
      name: c.name,
      profileImage: c.profileImage,
      social: c.linkedUser ? c.linkedUser.oauthAccounts.map((p) => p.provider) : null,
    }));

    return res.status(200).json(dataResult);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

router.post('', requireAuth, async (req, res) => {
  try {
    const parsed = CreateContactBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid Body', errors: flattenError(parsed.error) });
    }

    const { name } = parsed.data;

    const newContact = await prisma.contact.create({
      data: {
        name,
        owner: { connect: { id: req.auth!.userId } },
        profileImage: pickRandomDefaultProfileImage(),
      },
    });

    return res.status(201).json(newContact);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
