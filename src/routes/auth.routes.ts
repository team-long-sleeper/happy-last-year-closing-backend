import express from 'express';
import { prisma } from '@lib/prisma.js';
import { call, HttpError } from '@lib/http/call.js';
import { callKakaoUnlink } from '@lib/auth/kakao.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pickRandomDefaultProfileImage } from '../utils/defaultProfileImage.js';
import { decryptString, encryptString } from '@lib/security/crypto.js';
import { deleteUserUploadsFromR2 } from '../utils/r2.js';
import { generateRefreshToken, hashRefreshToken } from '@lib/auth/refreshToken.js';
import { OAuthProvider } from '../generated/prisma/enums.js';
import * as Sentry from '@sentry/node';
import { AppError, AuthError, NotFoundError } from '@lib/errors.js';
import { ACCOUNT_GRACE_PERIOD_MS, isWithinGracePeriod } from '../constants/account.js';
import { ACCESS_TTL_SECONDS, AUTH_COOKIE_OPTS, REFRESH_TTL_SECONDS } from '../constants/cookies.js';
import type { TransactionClient } from '../generated/prisma/internal/prismaNamespace.js';

const router = express.Router();
const api_host = 'https://kapi.kakao.com'; // 카카오 API 호출 서버 주소

const JWT_SECRET = assertEnv('JWT_SECRET');
const RESTORE_TTL_SECONDS = 60 * 10; // 10분 — pending 상태에서 복구/재생성 결정까지의 짧은 윈도우
const JWT_ISSUER = 'happy-last-year-closing';
const JWT_AUDIENCE_ACCESS = 'happy-last-year-closing';
// access JWT와 다른 audience를 둬서 두 토큰 종류가 서로 통용되지 않도록 분리한다.
const JWT_AUDIENCE_RESTORE = 'happy-last-year-closing-restore';

type RestoreTokenPayload = {
  userId: string;
  providerUserId: string;
  provider: OAuthProvider;
  purpose: 'restore';
};

type KakaoMeResponse = {
  id: number;
  properties: {
    nickname: string;
  };
  kakao_account: {
    profile_nickname_needs_agreement: boolean;
    profile: {
      nickname: string;
      is_default_nickname: boolean;
    };
  };
};

type OauthUserResponse = {
  id: string;
  name: string;
};

type OauthTokenParams = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
};

async function saveOauthTokens(
  tx: TransactionClient,
  provider: OAuthProvider,
  data: {
    providerUserId: string;
    userId: string;
    token: OauthTokenParams;
  },
) {
  if (provider === OAuthProvider.KAKAO) return await saveKakaoTokens(tx, data);
}

async function saveKakaoTokens(
  tx: TransactionClient,
  data: {
    providerUserId: string;
    userId: string;
    token: OauthTokenParams;
  },
) {
  const { providerUserId, userId, token } = data;

  const accessEnc = encryptString(token.access_token);
  const refreshEnc = encryptString(token.refresh_token);

  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  await tx.oAuthAccount.upsert({
    where: {
      provider_providerUserId: {
        provider: OAuthProvider.KAKAO,
        providerUserId,
      },
    },
    update: {
      userId,
      oauthAccessToken: accessEnc,
      oauthRefreshToken: refreshEnc,
      expiresAt,
    },
    create: {
      provider: OAuthProvider.KAKAO,
      providerUserId,
      userId,
      oauthAccessToken: accessEnc,
      oauthRefreshToken: refreshEnc,
      expiresAt,
    },
  });
}

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function signAccessToken(payload: { userId: string }) {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_ACCESS,
  });
}

// 계정이 ACCOUNT_DELETION_PENDING일 때 /signin이 발급하는 단명 토큰.
// 카카오 소유권 검증을 /signin에서 한 번만 하고, 그 결과를 짧은 시간 동안 신뢰할 수 있게 한다.
// 프론트는 이 토큰을 /restore-account, /recreate-account 호출 시 그대로 전달하면 된다.
function signRestoreToken(payload: Omit<RestoreTokenPayload, 'purpose'>) {
  return jwt.sign({ ...payload, purpose: 'restore' as const }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: RESTORE_TTL_SECONDS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_RESTORE,
  });
}

function verifyRestoreToken(token: string): RestoreTokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE_RESTORE,
  }) as RestoreTokenPayload;
  if (decoded.purpose !== 'restore') {
    throw new AuthError('Invalid restore token purpose', 'RESTORE_TOKEN_INVALID');
  }
  return decoded;
}

async function oauthGetProfile(
  provider: OAuthProvider,
  oauthAccessToken: string,
): Promise<OauthUserResponse | undefined> {
  switch (provider) {
    case 'KAKAO':
      try {
        const user = await fetchKakaoMe(oauthAccessToken);
        return { id: String(user.id), name: user.kakao_account.profile.nickname };
      } catch (e) {
        // 카카오가 401이면 "유저가 보낸 토큰이 만료/무효"라는 뜻이므로
        // 클라이언트 에러로 매핑. 그래야 /restore-account, /recreate-account에서
        // next(err) → 전역 핸들러가 500 대신 401로 응답한다.
        if (e instanceof HttpError && e.status === 401) {
          throw new AuthError('Invalid OAuth access token', 'OAUTH_TOKEN_INVALID');
        }
        throw e;
      }
    case 'GOOGLE':
    case 'NAVER':
  }
}

async function fetchKakaoMe(accessToken: string): Promise<KakaoMeResponse> {
  const uri = api_host + '/v2/user/me';
  const header = {
    'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    Authorization: `Bearer ${accessToken}`,
  };
  const result = await call('GET', uri, {}, header);

  return result;
}

// 하드 딜리트 — cascade 설정이 없는 관계를 수동 처리한 뒤 User 삭제.
// 유저가 /auth/recreate-account를 선택한 경우, 또는 유예기간 지난 뒤 lazy cleanup 시 호출.
//
// 삭제 전에 AbandonedAccount 감사 로그를 생성한다.
// 이름·에피소드 등 개인 콘텐츠는 포함하지 않으며, 식별자는 SHA-256 해시로만 보관한다.
// 목적: 동일 소셜 계정의 반복 부정 가입, 이상 IP 패턴 사후 추적.
async function hardDeleteUser(tx: TransactionClient, userId: string) {
  // 1. 감사 로그용 데이터 수집 (모두 삭제 전에 읽어야 함)
  const [user, oauthAccount, sessions] = await Promise.all([
    tx.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    }),
    tx.oAuthAccount.findFirst({
      where: { userId },
      select: { provider: true, providerUserId: true },
    }),
    tx.refreshSession.findMany({
      where: { userId, ip: { not: null } },
      orderBy: { lastUsedAt: 'desc' },
      select: { ip: true },
    }),
  ]);

  // 2. AbandonedAccount 생성 — oauthAccount가 없는 경우(이미 지워진 경우 등)는 스킵
  if (user && oauthAccount) {
    // SHA-256("KAKAO:12345678") 형태로 해시 — 원문 복원 불가
    const providerIdHash = crypto
      .createHash('sha256')
      .update(`${oauthAccount.provider}:${oauthAccount.providerUserId}`)
      .digest('hex');

    const ips = sessions.map((s) => s.ip!);
    const uniqueIps = [...new Set(ips)];

    // 가장 최근 IP를 해시 처리 (sessions는 lastUsedAt desc 정렬이므로 첫 번째가 최신)
    const lastKnownIpHash = ips[0]
      ? crypto.createHash('sha256').update(ips[0]).digest('hex')
      : null;

    const retainUntil = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1년

    await tx.abandonedAccount.create({
      data: {
        providerIdHash,
        provider: oauthAccount.provider,
        accountCreatedAt: user.createdAt,
        lastKnownIpHash,
        uniqueIpCount: uniqueIps.length,
        sessionCount: sessions.length,
        retainUntil,
      },
    });
  }

  // 3. 기존 삭제 로직 — User 삭제 시 cascade로 RefreshSession·Episode 등 함께 제거
  await tx.contact.updateMany({
    where: { linkedUserId: userId },
    data: { linkedUserId: null },
  });
  await tx.oAuthAccount.deleteMany({ where: { userId } });
  await tx.user.delete({ where: { id: userId } });
}

// 신규 유저 생성 — signin(첫 가입)과 recreate-account에서 공용으로 사용.
async function createUserFromOauth(
  tx: TransactionClient,
  provider: OAuthProvider,
  me: OauthUserResponse,
  token: OauthTokenParams,
) {
  const created = await tx.user.create({
    data: {
      name: me.name,
      profileImage: pickRandomDefaultProfileImage(),
      lastLoginAt: new Date(),
    },
  });
  await tx.oAuthAccount.create({
    data: { provider, providerUserId: me.id, userId: created.id },
  });
  await saveOauthTokens(tx, provider, {
    providerUserId: me.id,
    userId: created.id,
    token,
  });
  await tx.contact.updateMany({
    where: { providerUserId: me.id, linkedUserId: null },
    data: { linkedUserId: created.id },
  });
  return created;
}

router.post('/signin', async (req, res) => {
  try {
    const {
      provider,
      oauthAccessToken,
      oauthRefreshToken,
      oauthTokenExpiresAt,
      oauthRefreshExpiresIn,
    } = req.body as {
      provider: OAuthProvider;
      oauthAccessToken: string;
      oauthRefreshToken: string;
      oauthTokenExpiresAt: number;
      oauthRefreshExpiresIn: number;
    };

    if (!oauthAccessToken || typeof oauthAccessToken !== 'string') {
      return res.status(400).json({ message: 'oauthAccessToken is required' });
    }

    const me = await oauthGetProfile(provider, oauthAccessToken);

    if (!me) return res.status(400).json({ message: 'Cannot find User' });

    const { id: providerUserId } = me;

    const userExists = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: { user: true },
    });

    const token: OauthTokenParams = {
      access_token: oauthAccessToken,
      refresh_token: oauthRefreshToken,
      expires_in: oauthTokenExpiresAt,
      refresh_expires_in: oauthRefreshExpiresIn,
    };

    if (userExists) {
      const { user } = userExists;

      // 계정이 소프트 삭제 유예 상태: 프론트에 알려서 복구/재생성 선택을 받는다.
      // 여기서 어떤 JWT도 발급하지 않는다 — 유저가 결정하기 전까지 로그인된 상태가 아니어야 함.
      // NOTE 계정 삭제 중 (30일 내)인 유저가 다시 로그인 시도 시 'ACCOUNT_DELETION_PENDING' 플래그 반환
      // TODO 이거 나중에 response object 통일 시켜놔야할까?

      if (user.deletedAt && isWithinGracePeriod(user.deletedAt)) {
        // 카카오 consent 단계에서 앱이 재링크된 상태. 유저가 복구/재생성 결정 전에 이탈할 수 있으므로
        // 방금 받은 fresh 토큰을 저장해둔다 — 추후 cron/lazy cleanup이 이 토큰으로 카카오 unlink 시도 가능.
        // 여기서 JWT는 여전히 발급하지 않으므로 "로그인 상태"는 아님.
        await prisma.$transaction((tx) =>
          saveOauthTokens(tx, provider, { providerUserId, userId: user.id, token }),
        );

        // 카카오 소유권은 위 oauthGetProfile에서 이미 검증됨. 그 결과를 짧은 시간 동안 신뢰할 수 있도록
        // restoreToken에 서명해 내려준다. 프론트는 이 토큰만 /restore-account, /recreate-account에 전달.
        const restoreToken = signRestoreToken({
          userId: user.id,
          providerUserId,
          provider,
        });

        return res.status(200).json({
          status: 'ACCOUNT_DELETION_PENDING',
          user: { id: user.id, name: user.name, profileImage: user.profileImage },
          deletedAt: user.deletedAt.toISOString(),
          gracePeriodEndsAt: new Date(
            user.deletedAt.getTime() + ACCOUNT_GRACE_PERIOD_MS,
          ).toISOString(),
          restoreToken,
        });
      }

      // 유예기간이 지난 소프트 삭제 계정: cron이 정리하기 전이라면 여기서 lazy 하드 딜리트 후
      // 새 계정 생성 플로우로 fall through.
      if (user.deletedAt) {
        // 외부 정리 작업들은 모두 best-effort — 실패해도 하드 딜리트는 진행.
        // 방금 받은 fresh access token으로 카카오 unlink 먼저 시도.
        try {
          await callKakaoUnlink(oauthAccessToken);
        } catch (e) {
          Sentry.captureException(e, { tags: { feature: 'lazy_hard_delete_unlink' } });
        }
        // R2에 남은 옛 유저의 업로드 청소. DB cascade는 EpisodePicture 행만 지우고 실제 객체는 안 지움.
        try {
          await deleteUserUploadsFromR2(user.id);
        } catch (e) {
          Sentry.captureException(e, { tags: { feature: 'lazy_hard_delete_r2_cleanup' } });
        }
        await prisma.$transaction((tx) => hardDeleteUser(tx, user.id));
      } else {
        // NOTE 기존 유저 로그인
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });
          await saveOauthTokens(tx, provider, {
            providerUserId,
            userId: user.id,
            token,
          });
        });

        return res.status(200).json({
          user: { id: user.id, profileImage: user.profileImage },
        });
      }
    }

    const newUser = await prisma.$transaction((tx) => createUserFromOauth(tx, provider, me, token));

    // NOTE 신규 유저 로그인
    return res.status(200).json({ user: { id: newUser.id, profileImage: newUser.profileImage } });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    Sentry.captureException(error, { tags: { feature: 'signin' } });
    return res.status(500).json({ message: 'signin failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { userId } = req.body as { userId: string };

    const now = new Date();
    const refreshExpiresIn = new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000);

    const accessToken = signAccessToken({ userId });
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessionKey = crypto.randomBytes(32).toString('base64url');
    const sessionKeyHash = hashRefreshToken(sessionKey);

    const sessioncreate = await prisma.refreshSession.create({
      data: {
        userId,
        sessionKey: sessionKeyHash,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresIn,
        lastUsedAt: new Date(),
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new AuthError('User not found', 'USER_NOT_FOUND');

    // access token도 해시화 해야하는거 아닌가?
    res.cookie('access_token', accessToken, { ...AUTH_COOKIE_OPTS, maxAge: ACCESS_TTL_SECONDS * 1000 });
    res.cookie('refresh_key', sessionKey, { ...AUTH_COOKIE_OPTS, maxAge: REFRESH_TTL_SECONDS * 1000 });

    return res.status(200).json({ user });
  } catch (error) {
    if (error instanceof AuthError) {
      return res.status(401).json({ message: error.message });
    }
    // 예상 못한 에러 (DB, 외부 API 등)만 Sentry로
    Sentry.captureException(error, { tags: { feature: 'login' } });
    return res.status(500).json({ message: 'login failed' });
  }
});

// 유예기간 내 계정 복구 — signin에서 ACCOUNT_DELETION_PENDING 응답을 받은 뒤
// 유저가 "복구"를 선택했을 때 호출. 카카오 소유권은 /signin에서 이미 검증됐고, 그 결과가 restoreToken
// 서명에 담겨 있으므로 여기서 카카오 API를 다시 호출할 필요가 없다.
// 여기서도 JWT는 발급하지 않는다 — 기존 로그인 플로우(/login)로 이어지도록 userId만 돌려줌.
router.post('/restore-account', async (req, res, next) => {
  try {
    const { restoreToken } = req.body as { restoreToken?: string };

    if (!restoreToken || typeof restoreToken !== 'string') {
      throw new AppError('restoreToken is required', 400, 'INVALID_INPUT');
    }

    let payload: RestoreTokenPayload;
    try {
      payload = verifyRestoreToken(restoreToken);
    } catch {
      // 만료/서명 위변조 모두 같은 응답 — 클라이언트는 재로그인을 유도해야 함.
      throw new AuthError('Invalid or expired restore token', 'RESTORE_TOKEN_INVALID');
    }

    const account = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: payload.provider,
          providerUserId: payload.providerUserId,
        },
      },
      include: { user: true },
    });
    if (!account) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');
    // 토큰 발급 시점과 다른 user에 묶여있다면 (예: 그 사이 hard delete + 재가입) 거부.
    if (account.userId !== payload.userId) {
      throw new AuthError('Restore token does not match account', 'RESTORE_TOKEN_MISMATCH');
    }
    if (!account.user.deletedAt) {
      // 이미 생성된 계정이라고 판단
      return res.status(200).json({ code: 'ALREADY_RESTORED' });
    }
    if (!isWithinGracePeriod(account.user.deletedAt)) {
      // 유예기간을 지났으면 복구 불가. 새 계정 만들려면 /recreate-account로 안내.
      throw new AppError('Grace period expired', 410, 'GRACE_PERIOD_EXPIRED');
    }

    await prisma.user.update({
      where: { id: account.userId },
      data: { deletedAt: null, lastLoginAt: new Date() },
    });

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/expunge-account', async (req, res, next) => {
  try {
    const { restoreToken } = req.body as { restoreToken?: string };

    if (!restoreToken || typeof restoreToken !== 'string') {
      throw new AppError('restoreToken is required', 400, 'INVALID_INPUT');
    }

    let payload: RestoreTokenPayload;
    try {
      payload = verifyRestoreToken(restoreToken);
    } catch {
      throw new AuthError('Invalid or expired restore token', 'RESTORE_TOKEN_INVALID');
    }

    // read-only 검증은 트랜잭션 밖에서 — 외부 API 호출(카카오 unlink)을 트랜잭션 안에 넣지 않기 위함.
    const account = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: payload.provider,
          providerUserId: payload.providerUserId,
        },
      },
      include: { user: true },
    });
    if (!account) {
      // 이미 삭제됨 — idempotent success
      return res.status(200).json({ code: 'ALREADY_EXPUNGED' });
    }
    if (account.userId !== payload.userId) {
      throw new AuthError('Restore token does not match account', 'RESTORE_TOKEN_MISMATCH');
    }
    if (!account.user.deletedAt) {
      throw new AppError('Account is not pending deletion', 409, 'ACCOUNT_NOT_PENDING_DELETION');
    }

    // 외부 정리 작업들은 모두 best-effort — 실패해도 DB의 hardDelete는 진행.
    // hardDelete 전에 수행해야 일시 실패 시 다음 시도에서 DB의 메타데이터(토큰, key 등)를 다시 읽을 수 있음.
    if (account.oauthAccessToken) {
      try {
        const accessToken = decryptString(account.oauthAccessToken);
        await callKakaoUnlink(accessToken);
      } catch (e) {
        Sentry.captureException(e, { tags: { feature: 'expunge_account_unlink' } });
      }
    }

    try {
      await deleteUserUploadsFromR2(account.userId);
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: 'expunge_account_r2_cleanup' } });
    }

    await prisma.$transaction((tx) => hardDeleteUser(tx, account.userId));

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res) => {
  const refreshKey = req.cookies['refresh_key'];
  if (!refreshKey) return res.status(401).json({ error: 'NO_REFRESH_KEY' });

  const hashedKey = hashRefreshToken(refreshKey);

  const session = await prisma.refreshSession.findUnique({
    where: { sessionKey: hashedKey },
  });

  if (!session) return res.status(401).json({ error: 'CANNOT FIND SESSION' });
  if (session.revokedAt) return res.status(401).json({ error: 'REVOKED_REFRESH' });
  if (session.expiresAt.getTime() < Date.now())
    return res.status(401).json({ error: 'EXPIRED REFRESH TOKEN' });

  const xff = req.headers['x-forwarded-for']?.toString();
  const ip = xff ? xff.split(',')[0]?.trim() : req.ip;
  const ua = req.headers['user-agent']?.toString() ?? '';

  const newAccess = signAccessToken({ userId: session.userId });
  const newRefresh = generateRefreshToken();
  const newHash = hashRefreshToken(newRefresh);
  const newExpires = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
  const newSessionKey = crypto.randomBytes(32).toString('base64url');
  const sessionKeyHash = hashRefreshToken(newSessionKey);

  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.update({
      where: { id: session.id },
      data: {
        lastUsedAt: new Date(),
        revokedAt: new Date(),
        userAgent: ua,
      },
    });

    await tx.refreshSession.create({
      data: {
        userId: session.userId,
        sessionKey: sessionKeyHash,
        tokenHash: newHash,
        expiresAt: newExpires,
        ip: ip ?? null,
        userAgent: ua,
      },
    });
  });

  res.cookie('access_token', newAccess, { ...AUTH_COOKIE_OPTS, maxAge: ACCESS_TTL_SECONDS * 1000 });
  res.cookie('refresh_key', newSessionKey, { ...AUTH_COOKIE_OPTS, maxAge: REFRESH_TTL_SECONDS * 1000 });

  return res.sendStatus(204);
});

export default router;
