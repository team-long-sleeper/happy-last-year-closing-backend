import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import 'dotenv/config';

// Sentry는 다른 어떤 모듈보다 먼저 init 되어야 한다.
// (server.ts 최상단에서 이 파일을 import 할 것)
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  integrations: [nodeProfilingIntegration()],
  // 운영에서는 0.1~0.2 정도로 샘플링 낮추는 걸 권장
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 1.0),
  profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 1.0),
  // DSN이 없으면 아무것도 전송하지 않음 (로컬 개발 편의)
  enabled: Boolean(process.env.SENTRY_DSN),
  // 4xx류 예상 가능한 에러(AppError)는 Sentry로 보내지 않음.
  // 5xx/외부 시스템 장애 등 진짜 문제만 리포트하기 위함.
  beforeSend(event, hint) {
    const err = hint.originalException as { status?: number } | undefined;
    if (err && typeof err === 'object' && typeof err.status === 'number' && err.status < 500) {
      return null;
    }
    return event;
  },
});
