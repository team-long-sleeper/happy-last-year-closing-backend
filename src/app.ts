import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { routes } from './routes/index.js';

// express 앱을 구성하는 파일
// express()
// 미들웨어 붙이기, 라우터 마운트, 에러 핸들러 붙이기

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use(routes);

export default app;
