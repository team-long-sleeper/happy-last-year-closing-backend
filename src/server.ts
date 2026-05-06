import './instrument.js';
import * as Sentry from '@sentry/node';
import app from './app.js';

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.log(`API on http://localhost:${port}`));

// Express 바깥(setTimeout, 비동기 콜백, top-level 등)에서 발생한 에러는
// setupExpressErrorHandler가 잡지 못한다. process 레벨에서 직접 Sentry로 보낸다.
process.on('uncaughtException', (err) => {
  Sentry.captureException(err);
  console.error('uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason);
  console.error('unhandledRejection:', reason);
});

// 종료 시 큐에 남은 Sentry 이벤트를 flush 한 뒤 서버를 닫는다.
// (Sentry는 비동기 전송이라 즉시 process.exit 하면 이벤트 유실 가능)
const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down`);
  await Sentry.close(2000);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
