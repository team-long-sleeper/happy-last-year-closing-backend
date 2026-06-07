import type { CookieOptions } from 'express';

export const ACCESS_TTL_SECONDS = 60 * 15;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/', // 명시적으로 고정. 모든 라우트로 전송되고 set/clear 가 항상 같은 path 를 쓰도록.
} satisfies CookieOptions;
