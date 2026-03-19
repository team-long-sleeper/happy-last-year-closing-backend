import express from 'express';
import { prisma } from '@lib/prisma.js';
import { call } from '@lib/http/call.js';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { pickRandomDefaultProfileImage } from '../utils/defaultProfileImage.js';
import { encryptString } from '@lib/security/crypto.js';
import { OAuthProvider } from '../generated/prisma/enums.js';
import type { TransactionClient } from '../generated/prisma/internal/prismaNamespace.js';

const router = express.Router();
const api_host = 'https://kapi.kakao.com'; // 카카오 API 호출 서버 주소

const JWT_SECRET = assertEnv('JWT_SECRET');
const ACCESS_TTL_SECONDS = 60 * 15; // 15분
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

type KakaoMeResponse = {
  id: number;
  properties: {
    nickname: string;
    profile_image: string;
  };
  kakao_account: {
    profile_nickname_needs_agreement: boolean;
    profile_image_needs_agreement: boolean;
    profile: {
      nickname: string;
      profile_image_url: string;
      is_default_image: boolean;
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

  console.log('kakao token set', token.expires_in);

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
    issuer: 'happy-last-year-closing',
    audience: 'happy-last-year-closing',
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function hashRefreshToken(raw: string): string {
  // note refresh token pepper가 뭐야? (최소 SHA-256)?
  const pepper = process.env.REFRESH_TOKEN_PEPPER ?? '';
  return crypto
    .createHash('sha256')
    .update(raw + pepper)
    .digest('hex');
}

async function oauthGetProfile(
  provider: OAuthProvider,
  oauthAccessToken: string,
): Promise<OauthUserResponse | undefined> {
  if (provider === OAuthProvider.KAKAO) {
    const user = await fetchKakaoMe(oauthAccessToken);
    return { id: String(user.id), name: user.kakao_account.profile.nickname };
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

    const { id: providerUserId, name } = me;

    const userExists = await prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId,
        },
      },
      include: { user: true },
    });

    if (userExists) {
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userExists.userId },
          data: { lastLoginAt: new Date() },
        });

        await saveOauthTokens(tx, provider, {
          providerUserId,
          userId: userExists.userId,
          token: {
            access_token: oauthAccessToken,
            refresh_token: oauthRefreshToken,
            expires_in: oauthTokenExpiresAt,
            refresh_expires_in: oauthRefreshExpiresIn,
          },
        });
      });

      console.log('기존 유저 로그인 완료 ✔️');

      return res.status(200).json({
        user: { id: userExists.userId },
      });
    }

    const { newUser } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          name,
          profileImage: pickRandomDefaultProfileImage(),
          lastLoginAt: new Date(),
        },
      });

      await tx.oAuthAccount.create({
        data: { provider, providerUserId, userId: createdUser.id },
      });

      await saveOauthTokens(tx, provider, {
        providerUserId,
        userId: createdUser.id,
        token: {
          access_token: oauthAccessToken,
          refresh_token: oauthRefreshToken,
          expires_in: oauthTokenExpiresAt,
          refresh_expires_in: oauthRefreshExpiresIn,
        },
      });

      await tx.contact.updateMany({
        where: {
          providerUserId,
          linkedUserId: null,
        },
        data: {
          linkedUserId: createdUser.id,
        },
      });
      return { newUser: createdUser };
    });

    console.log('신규 유저 로그인 완료 ✔️');

    return res.status(200).json({ user: { id: newUser.id } });
  } catch (error) {
    console.log(error);
    return res.status(401).json({ message: 'login failed', error });
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

    // access token도 해시화 해야하는거 아닌가?
    res.cookie('access_token', accessToken, {
      maxAge: ACCESS_TTL_SECONDS * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
    });

    res.cookie('refresh_key', sessionKey, {
      maxAge: REFRESH_TTL_SECONDS * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api',
    });

    return res.status(200).json({ user });
  } catch (error) {
    console.log(error);
    console.log(error, '여기인가?');
    return res.status(401).json({ message: 'login failed', error });
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

  res.cookie('access_token', newAccess, {
    maxAge: ACCESS_TTL_SECONDS * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
  });

  res.cookie('refresh_key', newSessionKey, {
    maxAge: REFRESH_TTL_SECONDS * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
  });

  return res.sendStatus(204);
});

export default router;
