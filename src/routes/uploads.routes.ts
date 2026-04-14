import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../utils/r2.js';
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
  try {
    const ownerUserId = req.auth!.userId;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const prefix = `private/episodes/${ownerUserId}/${Date.now()}`;

    const uploads = await Promise.all(
      files.map(async (file) => {
        const key = `${prefix}/${crypto.randomUUID()}.${extFromMime(file.mimetype)}`;
        const { encrypted, iv } = encryptBuffer(file.buffer);

        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: encrypted,
            ContentType: 'application/octet-stream',
          }),
        );

        return { key, iv };
      }),
    );

    return res.json({ uploads });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
