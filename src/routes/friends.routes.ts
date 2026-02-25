import { prisma } from '@lib/prisma.js';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { pickRandomDefaultProfileImage } from '../utils/defaultProfileImage.js';

const router = express.Router();

router.get('', requireAuth, async (req, res) => {
  try {
    console.log(req.headers, 'request headers');
    const contacts = await prisma.contact.findMany({
      where: { ownerUserId: req.auth!.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
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
      profileImage: pickRandomDefaultProfileImage(),
      social: c.linkedUser ? c.linkedUser.oauthAccounts.map((p) => p.provider) : null,
    }));

    return res.status(201).json(dataResult);
  } catch (error) {
    console.log(error);
  }
});

router.post('', requireAuth, async (req, res) => {
  try {
    const { name } = req.body as { name: string };

    const newContact = await prisma.contact.create({
      data: { name, owner: { connect: { id: req.auth!.userId } } },
    });

    return res.status(201).json(newContact);
  } catch (error) {
    console.log(error);
  }
});

export default router;
