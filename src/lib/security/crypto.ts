import crypto from 'node:crypto';

const ENC_KEY_B64 = process.env.OATH_TOKEN_ENC_KEY_B64;
if (!ENC_KEY_B64) throw new Error('Missing env OATH_TOKEN_ENC_KEY_B64');

const KEY = Buffer.from(ENC_KEY_B64, 'base64');
if (KEY.length !== 32) throw new Error('OATH_TOKEN_ENC_KEY_B64 must decode to 32bytes');

const IMAGE_ENC_KEY_B64 = process.env.IMAGE_ENC_KEY_B64;
if (!IMAGE_ENC_KEY_B64) throw new Error('Missing env IMAGE_ENC_KEY_B64');

const IMAGE_KEY = Buffer.from(IMAGE_ENC_KEY_B64, 'base64');
if (IMAGE_KEY.length !== 32) throw new Error('IMAGE_ENC_KEY_B64 must decode to 32bytes');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);

  const cipherText = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 저장하기 쉬운 포맷: base64(iv).base64(tag).base64(ciphertext)
  // note 이 포맷이 뭔데 저장하기 쉽다는건데 ㅠㅠ ㅋㅋ
  return `${iv.toString('base64')}.${tag.toString('base64')}.${cipherText.toString('base64')}`;
}

export function decryptString(packed: string): string {
  const [ivB64, tagB64, dataB64] = packed.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);

  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString('utf-8');
}

// iv 포맷: "base64(iv).base64(authTag)"
export function encryptBuffer(plain: Buffer): { encrypted: Buffer; iv: string } {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, IMAGE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted, iv: `${iv.toString('base64')}.${tag.toString('base64')}` };
}

export function decryptBuffer(encrypted: Buffer, ivPacked: string): Buffer {
  const [ivB64, tagB64] = ivPacked.split('.');
  if (!ivB64 || !tagB64) throw new Error('Invalid iv format');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGO, IMAGE_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
