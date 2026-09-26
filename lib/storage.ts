import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const client = new S3Client({
  region: process.env.STORAGE_REGION || "auto",
  endpoint: process.env.STORAGE_ENDPOINT,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.STORAGE_BUCKET!;

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
export const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function isAllowedUpload(mimeType: string, size: number) {
  return ALLOWED_MIME_TYPES.has(mimeType) && size > 0 && size <= MAX_ATTACHMENT_BYTES;
}

/**
 * Generates a random, non-guessable storage key namespaced by task, so a
 * task's attachments live together but no one can enumerate another
 * task's files by incrementing an id.
 */
export function buildStorageKey(taskId: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `tasks/${taskId}/${crypto.randomBytes(8).toString("hex")}-${safeName}`;
}

export async function getUploadUrl(storageKey: string, mimeType: string) {
  const command = new PutObjectCommand({ Bucket: BUCKET, Key: storageKey, ContentType: mimeType });
  return getSignedUrl(client, command, { expiresIn: 300 }); // 5 minutes to upload
}

export async function getDownloadUrl(storageKey: string) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: storageKey });
  return getSignedUrl(client, command, { expiresIn: 300 });
}
