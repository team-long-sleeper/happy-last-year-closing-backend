import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

export const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_S3_ACCESS_KEY_SECRET!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

export const R2_BUCKET = process.env.R2_BUCKET!;

// 특정 key 목록을 R2에서 일괄 삭제. 에피소드/사진 단건 삭제 시 사용.
// S3/R2 batch delete 한도(1000)에 맞춰 슬라이스해서 호출.
export async function deleteObjectsFromR2(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await r2.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

// 유저가 업로드한 모든 객체를 prefix 기반으로 일괄 삭제. 계정 expunge 시 사용.
// uploads.routes.ts에서 `private/episodes/{userId}/...`로 저장하므로 그 prefix 전체를 청소.
// DB에 등록된 EpisodePicture.key뿐 아니라, 업로드 트랜잭션 실패로 남은 orphan까지 한 번에 처리.
export async function deleteUserUploadsFromR2(userId: string): Promise<void> {
  const Prefix = `private/episodes/${userId}/`;
  let ContinuationToken: string | undefined;

  do {
    const listResp = await r2.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix, ContinuationToken }),
    );

    const keys = (listResp.Contents ?? []).map((o) => o.Key).filter((k): k is string => Boolean(k));

    if (keys.length > 0) {
      // S3/R2 batch delete 한도가 1000개라 ListObjectsV2 페이지(최대 1000)와 1:1로 매핑됨.
      await r2.send(
        new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }

    ContinuationToken = listResp.IsTruncated ? listResp.NextContinuationToken : undefined;
  } while (ContinuationToken);
}
