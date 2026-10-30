# LaporinAja backend

Express and Prisma backend for LaporinAja using PostgreSQL. The MVP contract endpoints are under `/api`; the frontend is a separate React application.

## Project structure

```text
prisma/
  migrations/       Database migrations
  schema.prisma     Data models and relations
  seed.ts           Repeatable initial category seed
src/
  app.ts            Express app configuration
  server.ts         HTTP server entry point
  config/           Application configuration
  controllers/      HTTP request handlers
  middlewares/      Express middleware
  repositories/     Database access
  routes/           API route definitions
  services/         Application/business logic
  types/            Shared TypeScript types
  utils/            Shared utilities
  validators/       Request validation schemas
  db.ts             Prisma client
  public-code.ts    Server-side public report code generator
tests/
  api-contract.test.ts
```

## Requirements

- Node.js 20+
- PostgreSQL
- Docker and Docker Compose (optional, for containerized setup)

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`. The local defaults use the React origin `http://localhost:5173`, API `http://localhost:3000`, cookie `HttpOnly; SameSite=Lax; Secure=false`, and a 20 MB maximum request size.
3. Set `SESSION_SECRET` to a random value with at least 32 characters. For HTTPS deployments set `SESSION_COOKIE_SECURE=true`.
4. Set `DATABASE_URL` to your PostgreSQL connection string.
5. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` from your Cloudinary dashboard. Optionally set `CLOUDINARY_FOLDER` (default `laporinaja`).
6. Apply the migrations with `npm run db:deploy`.
7. Generate the Prisma client with `npm run prisma:generate`.
8. Populate the initial categories with `npm run db:seed`.
9. Start the development server with `npm run dev`.

The initial migration creates the six core entities, enums, relationships, unique constraints, indexes, and the sequence used to reserve public report codes. Prisma tracks applied migrations, so `npm run db:deploy` can be run repeatedly; the category seed uses upserts and is safe to repeat. Prisma 7 uses the PostgreSQL driver adapter configured in `src/db.ts`.

`POST /api/reports` reserves a public code from PostgreSQL's sequence through `src/public-code.ts` and returns `LPR-<year>-<number>`; the unique constraint on `reports.public_code` remains the final integrity guard. Sequence gaps are expected if a reserved code is not used.

## API contract

- Success responses use `{ "data": ... }`. Lists use `{ "data": [], "meta": { "page": 1, "limit": 12, "total": 0 } }`; private list responses also include `counts` keyed by every report status.
- Errors use `{ "error": { "code": "...", "message": "...", "fields": {} } }` with Indonesian messages and no stack traces.
- Available endpoint groups: `/api/auth`, `/api/categories`, `/api/reports`, `/api/me/reports`, `/api/admin/reports`, `/api/stats/public`, and `/api/admin/stats`.
- Browser mutations require an exact allowed `Origin`; authenticated mutations also require the `laporinaja_csrf` cookie value in the `X-CSRF-Token` header. The signed JWT session token stays in an HttpOnly cookie and must match an active database session, so logout revokes it immediately.
- Google sign-in uses `POST /api/auth/google` with `{ "credential": "<Google ID token>" }`. Set `GOOGLE_CLIENT_ID` to the OAuth 2.0 Web client ID used by Google Identity Services; the backend verifies the token audience and verified email before creating a `PELAPOR` account or session.
- React must send credentialed requests (`credentials: "include"` or `withCredentials: true`). For multipart requests, let the browser generate the `Content-Type` boundary.
- Report images are checked against decoded image content and MIME, re-encoded with Sharp to remove metadata, and uploaded to Cloudinary as authenticated assets under a random public ID. The API proxies access through the signed media endpoint, so private reports are only served to authorized viewers.

The selected local/demo topology is React `http://localhost:5173` to API `http://localhost:3000`, `SameSite=Lax`, `Secure=false` on local HTTP, 3 files maximum at 5 MB each, and 20 MB maximum request size. These settings are environment-configurable. A cross-site deployment needs an explicit cookie/CSRF design and HTTPS; do not disable Origin or CSRF checks.

`npm test` runs mocked API contract tests for envelopes, CORS/Origin, cookie login/logout, authorization, idempotency, upload failure, status conflicts/transitions, rate limiting, public privacy DTOs, and both ways to resolve a report. The repository contains only the backend, so shared React–Express tests and a live PostgreSQL migration run require the separate frontend and a running PostgreSQL service.

## Docker

For local development, copy `.env.example` to `.env`, then run:

```sh
docker compose up --build
```

Compose starts PostgreSQL and the API, waits until PostgreSQL is healthy, applies migrations and the repeatable category seed, then starts Express. The API is available at `http://localhost:3000` and `GET /health` can be used to check it. PostgreSQL data is persisted in the `postgres_data` volume. Image uploads are stored in Cloudinary, so the Cloudinary credentials from `.env` must be set before starting the stack.

The credentials in `.env.example` are for local development only; change them before using this setup outside a local machine. Stop the containers with `docker compose down`. Removing the database volume with `docker compose down --volumes` permanently deletes local database data.
