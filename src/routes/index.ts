import { Router } from 'express';
import { Pool } from 'pg';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import friendsRoutes from './friends.routes.js';

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
