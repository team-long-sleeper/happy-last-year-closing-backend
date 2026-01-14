import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Pool } from 'pg';
import 'dotenv/config';

const app = express();

app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.get('/health', async (_req, res) => {
  const r = await pool.query('select now() as now');
  res.json({ ok: true, dbTime: r.rows[0].now });
});

app.get('/entries', async (_req, res) => {
  const r = await pool.query(
    'select id, title, content, created_at from entries order by id desc limit 50'
  );
  res.json(r.rows);
});

app.post('/entries', async (req, res) => {
  const { title, content } = req.body ?? {};
  if (typeof title !== 'string' || typeof content !== 'string') {
    return res.status(400).json({ message: 'title/content required' });
  }

  const r = await pool.query(
    'insert into entries (title, content) values ($1, $2) returning id, title, content, created_at',
    [title, content]
  );
  res.status(201).json(r.rows[0]);
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`API on http://localhost:${port}`));
