import { call } from '@lib/http/call.js';
import { prisma } from '@lib/prisma.js';
import { hashRefreshToken } from '@lib/auth/refreshToken.js';
import { getKakaoAccessToken, unlinkKakao } from '@lib/auth/kakao.js';
import { requireAuth } from '../middleware/auth.js';
import { NotFoundError } from '@lib/errors.js';
import * as Sentry from '@sentry/node';
import express from 'express';

const router = express.Router();
const api_host = 'https://kapi.kakao.com'; // 카카오 API 호출 서버 주소

// 쿠키 옵션은 auth.routes.ts에서 쿠키를 발급할 때 쓴 값과 동일해야
// clearCookie가 실제로 같은 쿠키를 지운다. (path/sameSite/secure 불일치 시 못 지움)
const AUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
};

function clearAuthCookies(res: express.Response) {
  res.clearCookie('access_token', AUTH_COOKIE_OPTS);
  res.clearCookie('refresh_key', AUTH_COOKIE_OPTS);
}

// 내 프로필 조회 — DB에 저장된 값을 반환 (카카오 /v2/user/me 호출은 signin 시점에만 필요)
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, name: true, profileImage: true },
    });
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    return res.status(200).json({ id: user.id, name: user.name, profileImage: user.profileImage });
  } catch (err) {
    next(err);
  }
});

// 로그아웃 — 카카오 세션 종료 + 현재 기기의 refresh 세션만 폐기 (다른 기기 로그인은 유지)
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const kakaoAccessToken = await getKakaoAccessToken(req.auth!.userId);
    if (kakaoAccessToken) {
      try {
        await call('POST', api_host + '/v1/user/logout', null, {
          Authorization: `Bearer ${kakaoAccessToken}`,
        });
      } catch (e) {
        // 카카오 측 실패해도 우리 서버 세션은 정리해야 하므로 계속 진행
        Sentry.captureException(e, { tags: { feature: 'kakao_logout' } });
      }
    }

    const refreshKey = req.cookies?.refresh_key;
    if (refreshKey) {
      const hashed = hashRefreshToken(refreshKey);
      await prisma.refreshSession.updateMany({
        where: { sessionKey: hashed, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    clearAuthCookies(res);
    return res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

// 계정 삭제 (소프트 삭제) — deletedAt만 세팅하고 유예기간(기본 30일) 내에는 복구 가능.
// 하드 딜리트와 카카오 unlink는 유예기간이 지난 뒤 cron에서, 또는 유저가
// /auth/recreate-account로 재생성을 선택할 때 수행한다.
router.delete('/account', requireAuth, async (req, res, next) => {
  try {
    const userId = req.auth!.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { deletedAt: true },
    });
    if (user?.deletedAt) {
      clearAuthCookies(res);
      return res.sendStatus(204); // 이미 삭제됨, 멱등 응답
    }

    // 카카오 앱 연결 즉시 해제 (best-effort). 실패해도 소프트 삭제는 계속 진행.
    const unlinked = await unlinkKakao(userId);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date() },
      }),

      // 같은 유저의 다른 기기 로그인도 즉시 끊는다 (삭제 요청이니 당연)
      prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      ...(unlinked
        ? [
            prisma.oAuthAccount.updateMany({
              where: { userId },
              data: { oauthAccessToken: null, oauthRefreshToken: null, expiresAt: null },
            }),
          ]
        : []),
    ]);

    clearAuthCookies(res);

    return res.sendStatus(204);
  } catch (err) {
    next(err);
  }
});

export default router;
