import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, deleteObjectsFromR2 } from '../utils/r2.js';
import { encryptBuffer } from '../lib/security/crypto.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(file.mimetype));
  },
});

function extFromMime(mime: string) {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
      return 'heic';
    default:
      return 'bin';
  }
}

// POST /uploads/pictures
// multipart/form-data, field name: "files" (최대 5장)
// response: { uploads: [{ key, iv }] }
router.post('/pictures', requireAuth, upload.array('files', 5), async (req, res) => {
  const ownerUserId = req.auth!.userId;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' });
  }

  const prefix = `private/episodes/${ownerUserId}/${Date.now()}`;

  // 부분 실패 시 성공한 객체가 R2에 orphan으로 남는 걸 막기 위해 allSettled 사용.
  // 하나라도 실패하면 성공한 key들을 청소한 뒤 원본 에러를 throw (전역 핸들러가 Sentry/응답 처리).
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const key = `${prefix}/${crypto.randomUUID()}.${extFromMime(file.mimetype)}`;
      const { encrypted, iv } = encryptBuffer(file.buffer);

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: encrypted,
          ContentType: 'application/octet-stream',
          ContentLength: encrypted.length,
        }),
      );

      return { key, iv };
    }),
  );

  const firstRejected = results.find((r) => r.status === 'rejected');
  if (firstRejected) {
    const orphanKeys = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value.key);

    // 청소가 실패해도 원본 업로드 에러를 우선 보고해야 하므로 로깅만.
    try {
      await deleteObjectsFromR2(orphanKeys);
    } catch (cleanupErr) {
      console.error('[uploads.pictures] orphan 청소 실패', { orphanKeys, cleanupErr });
    }

    throw firstRejected.reason;
  }

  const uploads = results.map((r) => (r as PromiseFulfilledResult<{ key: string; iv: string }>).value);

  return res.json({ uploads });
});

export default router;
