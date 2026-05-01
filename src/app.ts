import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import { routes } from './routes/index.js';
import { AppError } from './lib/errors.js';

// express 앱을 구성하는 파일
// express()
// 미들웨어 붙이기, 라우터 마운트, 에러 핸들러 붙이기

const app = express();

// 로그인·가입 등 인증 엔드포인트: IP당 15분에 10회
// 브루트포스, 크리덴셜 스터핑 방어
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
});

// 사진 업로드: IP당 1분에 20회 (5장 * 4번 업로드 정도면 충분)
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many upload requests.', code: 'RATE_LIMITED' },
});

// 일반 API: IP당 1분에 120회
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' },
});

app.use(helmet());
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }),
);

app.use('/api/auth/signin', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/uploads', uploadLimiter);
app.use('/api', generalLimiter);

app.use(routes);

// Sentry 에러 핸들러는 반드시 다른 에러 핸들러/라우트 이후에 등록해야 한다.
// Express 5에서 throw/reject된 에러를 잡아 Sentry로 전송.
// (4xx AppError는 instrument.ts의 beforeSend에서 필터링됨)
Sentry.setupExpressErrorHandler(app);

// 전역 에러 핸들러 - Sentry 이후에 등록해야 클라이언트 응답을 처리할 수 있다.
// AppError는 status/code로 응답, 나머지는 500으로 응답.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    console.error(err);
    return res.status(500).json({ message: 'Internal server error' });
  },
);

export default app;
