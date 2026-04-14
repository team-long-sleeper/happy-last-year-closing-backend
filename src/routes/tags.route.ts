import { prisma } from '@lib/prisma.js';
import express from 'express';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /tags — list all tags owned by current user
router.get('', requireAuth, async (req, res) => {
  try {
    const tags = await prisma.tag.findMany({
      where: { ownerUserId: req.auth!.userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        label: true,
        color: true,
        _count: { select: { episodes: true } },
      },
    });

    return res.status(200).json(tags);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// POST /tags — create a new tag
router.post('', requireAuth, async (req, res) => {
  try {
    const { label, color } = req.body as { label: string; color?: string };

    if (!label) {
      return res.status(400).json({ message: 'label is required' });
    }

    const tag = await prisma.tag.create({
      data: {
        label: label.trim(),
        ...(color !== undefined && { color }),
        owner: { connect: { id: req.auth!.userId } },
      },
    });

    return res.status(201).json(tag);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Tag label already exists' });
    }
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// PATCH /tags/:id — rename or recolor a tag
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const tagId = Number(req.params.id);
    if (!Number.isInteger(tagId)) return res.status(400).json({ message: 'Invalid Id' });
    const { label, color } = req.body as { label?: string; color?: string };

    const existing = await prisma.tag.findFirst({
      where: { id: tagId, ownerUserId: req.auth!.userId },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Tag not found' });
    }

    const updated = await prisma.tag.update({
      where: { id: tagId },
      data: {
        ...(label && { label: label.trim() }),
        ...(color !== undefined && { color }),
      },
    });

    return res.status(200).json(updated);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ message: 'Tag label already exists' });
    }
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// DELETE /tags/:id — delete a tag (EpisodeTag rows cascade automatically)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const tagId = Number(req.params.id);
    if (!Number.isInteger(tagId)) return res.status(400).json({ message: 'Invalid Id' });

    const existing = await prisma.tag.findFirst({
      where: { id: tagId, ownerUserId: req.auth!.userId },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Tag not found' });
    }

    await prisma.tag.delete({ where: { id: tagId } });

    return res.status(204).send();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
