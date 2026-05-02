import { call, HttpError } from '@lib/http/call.js';
import { prisma } from '@lib/prisma.js';
import { decryptString, encryptString } from '@lib/security/crypto.js';
import { OAuthProvider } from '../../generated/prisma/enums.js';
import * as Sentry from '@sentry/node';

const api_host = 'https://kapi.kakao.com';

// DB에 저장된 카카오 access token을 복호화해서 반환. 없으면 null.
export async function getKakaoAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: OAuthProvider.KAKAO },
  });
  if (!account?.oauthAccessToken) return null;
  return decryptString(account.oauthAccessToken);
}

// 카카오 access token을 refresh token으로 갱신. 성공 시 새 access token(평문)을 반환.
// 실패는 throw로 전달 — 호출자가 맥락(어느 플로우의 refresh인지)에 맞게 처리한다.
export async function updateKakaoAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: OAuthProvider.KAKAO },
  });
  if (!account?.oauthRefreshToken) return null;

  // DB에 저장된 refresh token은 암호화 상태이므로 카카오에 보내기 전에 복호화.
  const decryptedRefreshToken = decryptString(account.oauthRefreshToken);

  const updatedTokens = await call(
    'POST',
    api_host + '/oauth/token',
    {
      grant_type: 'refresh_token',
      client_id: `${process.env.KAKAO_PLATFORMKEY_REST_API}`,
      refresh_token: decryptedRefreshToken,
      client_secret: `${process.env.KAKAO_CLIENT_SECRET}`,
    },
    {
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
  );

  const accessEnc = encryptString(updatedTokens.access_token);
  const expiresAt = new Date(Date.now() + updatedTokens.expires_in * 1000);

  await prisma.oAuthAccount.update({
    where: {
      provider_providerUserId: {
        provider: OAuthProvider.KAKAO,
        providerUserId: account.providerUserId,
      },
    },
    data: {
      oauthAccessToken: accessEnc,
      expiresAt,
      // 카카오는 refresh_token이 만료 1개월 이내로 남았을 때만 새로 내려준다.
      // 없을 때 덮어쓰면 기존 refresh_token이 날아가므로 있을 때만 갱신.
      ...(updatedTokens.refresh_token && {
        oauthRefreshToken: encryptString(updatedTokens.refresh_token),
      }),
    },
  });

  return updatedTokens.access_token;
}

// 카카오 unlink API 호출 (저수준). 토큰 한 개로 단순 호출. throw 가능.
export async function callKakaoUnlink(accessToken: string) {
  return await call('POST', api_host + '/v1/user/unlink', null, {
    Authorization: `Bearer ${accessToken}`,
  });
}

// 카카오 앱 unlink를 best-effort로 수행한다. 실패해도 throw하지 않음 —
// 이 헬퍼는 계정 삭제/연결 해제 흐름의 한 단계로 쓰이는데, 메인 작업(소프트 삭제 등)은
// 카카오 호출 결과와 무관하게 반드시 완료돼야 하기 때문.
// access token이 만료돼서 401이 떨어지면 refresh로 한 번 재시도한다.
// 성공 여부를 boolean으로 반환 — 호출자가 후속 처리(예: 토큰 null 처리) 분기에 사용.
export async function unlinkKakao(userId: string): Promise<boolean> {
  let accessToken: string | null = null;
  try {
    accessToken = await getKakaoAccessToken(userId);
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'kakao_unlink', step: 'token_decrypt' } });
    return false;
  }
  if (!accessToken) return false;

  try {
    await callKakaoUnlink(accessToken);
    return true;
  } catch (e) {
    // 401이 아니면 refresh로 복구 불가 — 바로 로깅하고 종료.
    if (!(e instanceof HttpError) || e.status !== 401) {
      Sentry.captureException(e, { tags: { feature: 'kakao_unlink' } });
      return false;
    }
    // 401 → access token 만료 추정, 아래서 refresh 후 재시도.
  }

  let refreshedToken: string | null = null;
  try {
    refreshedToken = await updateKakaoAccessToken(userId);
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'kakao_unlink', step: 'token_refresh' } });
    return false;
  }
  if (!refreshedToken) return false;

  try {
    await callKakaoUnlink(refreshedToken);
    return true;
  } catch (e) {
    // 재시도도 실패 — refresh token까지 무효화됐거나 카카오 쪽 이슈.
    // 더 이상 retry하지 않음(무한 루프 방지).
    Sentry.captureException(e, { tags: { feature: 'kakao_unlink', step: 'retry' } });
    return false;
  }
}
