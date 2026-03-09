import express from 'express';
import z, { flattenError } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET } from '../utils/r2.js';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const router = express.Router();

const Body = z.object({
  mimeTypes: z.array(z.string().min(3)).min(1).max(50),
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

router.post('/presign', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.auth!.userId;
    const parsed = Body.safeParse(req.body);

    console.log('/presign parsed', parsed);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid body', errors: flattenError(parsed.error) });
    }

    console.log('/presign parsed.data', parsed.data);

    const { mimeTypes } = parsed.data;

    const prefix = `private/episodes/${ownerUserId}/${Date.now()}`;

    const uploads = await Promise.all(
      mimeTypes.map(async (mimeType) => {
        const key = `${prefix}/${crypto.randomUUID()}.${extFromMime(mimeType)}`;

        const cmd = new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          ContentType: mimeType,
        });

        const uploadUrl = await getSignedUrl(r2, cmd, { expiresIn: 60 * 10 }); //10분

        return { key, uploadUrl, mimeType };
      }),
    );

    console.log('uploads ---------------------------------->', uploads);

    return res.json({ uploads });
  } catch (error) {
    console.log(error);
  }
});

export default router;
