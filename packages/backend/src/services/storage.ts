/**
 * Attachment storage (design Decision 14).
 *
 * Files live in MinIO; Postgres holds only metadata. The S3 API is used rather than a
 * MinIO-specific client so that pointing at a different object store later is configuration
 * rather than a rewrite.
 *
 * Retention couples the two: when a run is removed by retention, its objects must go with
 * it, or files outlive the rows referencing them (data-lifecycle spec).
 */

import type { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export type ObjectStore = {
  ensureBucket(): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  deleteMany(keys: string[]): Promise<void>;
};

export function createObjectStore(config: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}): ObjectStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // MinIO serves path-style addressing; virtual-host style would resolve the bucket as a
    // subdomain and fail.
    forcePathStyle: true,
  });

  return {
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      }
    },
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return response.Body as Readable;
    },
    async deleteMany(keys) {
      if (keys.length === 0) return;
      // S3 deletes at most 1000 objects per request.
      for (let i = 0; i < keys.length; i += 1000) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
          }),
        );
      }
    },
  };
}
