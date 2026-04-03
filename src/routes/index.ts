import { Router } from 'express';
import { Pool } from 'pg';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import friendsRoutes from './friends.routes.js';
import episodesRoutes from './episodes.routes.js';
import uploadsRoutes from './uploads.routes.js';
import staticsRoutes from './stats.route.js';
import tagsRoutes from './tags.route.js';

export const routes = Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

routes.get('/health', async (_req, res) => {
  const r = await pool.query('select now() as now');
  res.json({ ok: true, dbTime: r.rows[0].now });
});

routes.use('/auth', authRoutes);
routes.use('/user', userRoutes);
routes.use('/friends', friendsRoutes);
routes.use('/episodes', episodesRoutes);
routes.use('/uploads', uploadsRoutes);
routes.use('/tags', tagsRoutes);
routes.use('/statics', staticsRoutes);
