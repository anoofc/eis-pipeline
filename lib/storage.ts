import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { localDemo } from "./auth";

let client: S3Client | undefined;
function bucketConfig() {
  const { S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_BUCKET || !S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new Error("Private object storage is not configured.");
  client ??= new S3Client({
    endpoint: S3_ENDPOINT, region: S3_REGION ?? "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, Bucket: S3_BUCKET };
}
const directory = () => resolve(/*turbopackIgnore: true*/ process.env.EIS_LOCAL_FILES ?? ".eis-data/files");
function localPath(key: string) {
  if (!/^[a-f0-9-]{36}$/i.test(key)) throw new Error("Invalid storage key.");
  return resolve(directory(), key);
}
export async function putObject(Key: string, Body: Buffer, ContentType: string) {
  if (localDemo()) {
    await mkdir(directory(), { recursive: true });
    await writeFile(localPath(Key), Body, { flag: "wx", mode: 0o600 });
  } else {
    const { client, Bucket } = bucketConfig();
    await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
  }
}
export async function getObject(Key: string) {
  if (localDemo()) return readFile(/*turbopackIgnore: true*/ localPath(Key));
  const { client, Bucket } = bucketConfig();
  const result = await client.send(new GetObjectCommand({ Bucket, Key }));
  if (!result.Body) throw new Error("File body missing.");
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function deleteObject(Key: string) {
  if (localDemo()) return unlink(localPath(Key));
  const { client, Bucket } = bucketConfig();
  await client.send(new DeleteObjectCommand({ Bucket, Key }));
}
