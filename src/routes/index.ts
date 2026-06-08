import { Router } from 'express';
import { prisma } from '@lib/prisma.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import friendsRoutes from './friends.routes.js';
import episodesRoutes from './episodes.routes.js';
import uploadsRoutes from './uploads.routes.js';
import staticsRoutes from './stats.route.js';
import tagsRoutes from './tags.route.js';
import contactsRoutes from './contacts.routes.js';

export const routes = Router();

routes.get('/health', async (_req, res) => {
  const [row] = await prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS now`;
  res.json({ ok: true, dbTime: row.now });
});

routes.use('/auth', authRoutes);
routes.use('/user', userRoutes);
routes.use('/friends', friendsRoutes);
routes.use('/episodes', episodesRoutes);
routes.use('/uploads', uploadsRoutes);
routes.use('/tags', tagsRoutes);
routes.use('/contacts', contactsRoutes);
routes.use('/statics', staticsRoutes);
