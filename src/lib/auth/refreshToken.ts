import crypto from 'node:crypto';

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashRefreshToken(raw: string): string {
  const pepper = process.env.REFRESH_TOKEN_PEPPER ?? '';
  return crypto
    .createHash('sha256')
    .update(raw + pepper)
    .digest('hex');
}
