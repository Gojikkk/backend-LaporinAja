import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { Express } from "express";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env";
import { HttpError } from "./http-error";

const maxFileBytes = 5 * 1024 * 1024;
const acceptedFormats = new Set(["jpeg", "png", "webp"]);

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true
});

export type StoredImage = {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

function uploadToCloudinary(buffer: Buffer): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        type: "authenticated",
        folder: env.cloudinaryFolder,
        public_id: randomUUID(),
        overwrite: false
      },
      (error, result) => {
        if (error) reject(error);
        else if (!result) reject(new Error("Cloudinary tidak mengembalikan hasil unggahan"));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

export async function storeImages(files: Express.Multer.File[]): Promise<StoredImage[]> {
  const stored: StoredImage[] = [];

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

      let uploaded: UploadApiResponse;
      try {
        uploaded = await uploadToCloudinary(normalized);
      } catch {
        throw new HttpError(502, "UPLOAD_FAILED", "Gagal mengunggah foto ke Cloudinary", {
          photos: "Foto gagal diunggah, silakan coba lagi"
        });
      }

      stored.push({
        storageKey: uploaded.public_id,
        mimeType,
        sizeBytes: normalized.length
      });
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
      await cloudinary.uploader.destroy(key, {
        resource_type: "image",
        type: "authenticated",
        invalidate: true
      });
    } catch (error) {
      console.error("Gagal menghapus gambar Cloudinary", key, error);
    }
  }));
}

export function imageUrl(key: string): string {
  return cloudinary.url(key, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true
  });
}
