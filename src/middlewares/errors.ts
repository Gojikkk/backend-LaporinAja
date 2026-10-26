import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../utils/http-error";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {})
      }
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: { code: "BAD_REQUEST", message: "Format JSON tidak valid" } });
    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Upload tidak valid",
        fields: {
          photos: error.code === "LIMIT_FILE_SIZE"
            ? "Ukuran maksimum setiap foto adalah 5 MB"
            : "Unggah maksimal 3 foto"
        }
      }
    });
    return;
  }

  if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") {
    response.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Data tidak valid",
        fields: { request: "Ukuran permintaan melebihi batas" }
      }
    });
    return;
  }

  console.error("Unhandled request error", error);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server" } });
};
