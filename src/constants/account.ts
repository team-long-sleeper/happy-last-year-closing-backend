// 계정 소프트 삭제 후 하드 딜리트 전까지 복구 가능한 유예기간.
// 이 기간 내에 signin 하면 복구/재생성 선택 프롬프트를 띄운다.
export const ACCOUNT_GRACE_PERIOD_DAYS = 30;
export const ACCOUNT_GRACE_PERIOD_MS = ACCOUNT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

export function isWithinGracePeriod(deletedAt: Date): boolean {
  return Date.now() - deletedAt.getTime() < ACCOUNT_GRACE_PERIOD_MS;
}
