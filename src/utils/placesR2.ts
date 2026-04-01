import { S3Client } from '@aws-sdk/client-s3';

export const placesR2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_PLACES_ENDPOINT!,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_S3_ACCESS_KEY_SECRET!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const PLACE_R2_BUCKET = process.env.R2_PLACES_BUCKET!;
