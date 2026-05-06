import axios from 'axios';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PLACE_R2_BUCKET, placesR2 } from './placesR2.js';

interface FetchThumbnailParams {
  placeName: string;
  lat: number;
  lng: number;
  providerId: string;
}

export async function fetchAndUploadPlaceThumbnail({
  placeName,
  lat,
  lng,
  providerId,
}: FetchThumbnailParams): Promise<string | null> {
  // 1. Google Places - photo_reference 획득
  const findRes = await axios.get(
    'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    {
      params: {
        input: placeName,
        inputtype: 'textquery',
        fields: 'photos',
        locationbias: `point:${lat},${lng}`,
        key: process.env.GOOGLE_API_KEY,
      },
    },
  );

  const photoRef = findRes.data.candidates?.[0]?.photos?.[0]?.photo_reference;
  if (!photoRef) return null;

  // 2. 이미지 binary 다운로드
  const photoRes = await axios.get<ArrayBuffer>(
    'https://maps.googleapis.com/maps/api/place/photo',
    {
      params: {
        maxwidth: 400,
        photo_reference: photoRef,
        key: process.env.GOOGLE_API_KEY,
      },
      responseType: 'arraybuffer',
    },
  );

  const contentType = photoRes.headers['content-type'] ?? 'image/jpeg';

  // 3. R2 업로드
  const key = `places/${providerId}/thumbnail.jpg`;
  await placesR2.send(
    new PutObjectCommand({
      Bucket: PLACE_R2_BUCKET,
      Key: key,
      Body: Buffer.from(photoRes.data),
      ContentType: contentType,
    }),
  );

  return `${process.env.R2_PLACES_PUBLIC_URL}/${key}`;
}
