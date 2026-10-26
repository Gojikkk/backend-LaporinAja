import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import type { Express } from "express";
import { env } from "../config/env";
import { HttpError } from "./http-error";

const maxFileBytes = 5 * 1024 * 1024;
const acceptedFormats = new Set(["jpeg", "png", "webp"]);

export async function storeImages(files: Express.Multer.File[]): Promise<Array<{
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}>> {
  const directory = path.resolve(env.uploadDir);
  await mkdir(directory, { recursive: true });
  const stored: Array<{ storageKey: string; mimeType: string; sizeBytes: number }> = [];

  try {
    for (const file of files) {
      if (file.size > maxFileBytes) {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          photos: "Ukuran maksimum setiap foto adalah 5 MB"
        });
      }

      let metadata: Metadata;
      try {
        metadata = await sharp(file.buffer, { failOn: "error" }).metadata();
      } catch {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          photos: "File bukan gambar JPG, PNG, atau WebP yang valid"
        });
      }
      if (!metadata.format || !acceptedFormats.has(metadata.format)) {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          photos: "Foto harus berupa JPG, PNG, atau WebP valid"
        });
      }
      const mimeType = `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format}`;
      if (file.mimetype !== mimeType) {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          photos: "MIME file tidak sesuai dengan isi gambar"
        });
      }

      const extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
      const storageKey = `${randomUUID()}.${extension}`;
      const image = sharp(file.buffer, { failOn: "error" }).rotate();
      let normalized: Buffer;
      try {
        normalized = metadata.format === "jpeg"
          ? await image.jpeg().toBuffer()
          : metadata.format === "png"
            ? await image.png().toBuffer()
            : await image.webp().toBuffer();
      } catch {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          photos: "Foto tidak dapat diproses"
        });
      }
      await writeFile(path.join(directory, storageKey), normalized, { flag: "wx" });
      stored.push({ storageKey, mimeType, sizeBytes: normalized.length });
    }
    return stored;
  } catch (error) {
    await deleteStoredImages(stored.map(({ storageKey }) => storageKey));
    throw error;
  }
}

export async function deleteStoredImages(keys: string[]): Promise<void> {
  await Promise.all(keys.map(async (key) => {
    try {
      await unlink(path.join(path.resolve(env.uploadDir), path.basename(key)));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
  }));
}

export function imagePath(key: string): string {
  return path.join(path.resolve(env.uploadDir), path.basename(key));
}
