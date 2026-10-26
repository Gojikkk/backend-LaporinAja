# LaporinAja backend

Express and Prisma backend scaffold using PostgreSQL. The API currently only exposes `GET /health`; report and account behavior is intentionally left for implementation.

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
```

## Requirements

- Node.js 20+
- PostgreSQL
- Docker and Docker Compose (optional, for containerized setup)

## Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your PostgreSQL connection string.
3. Apply the migrations with `npm run db:deploy`.
4. Generate the Prisma client with `npm run prisma:generate`.
5. Populate the initial categories with `npm run db:seed`.
6. Start the development server with `npm run dev`.

The initial migration creates the six core entities, enums, relationships, unique constraints, indexes, and the sequence used to reserve public report codes. Prisma tracks applied migrations, so `npm run db:deploy` can be run repeatedly; the category seed uses upserts and is safe to repeat. Prisma 7 uses the PostgreSQL driver adapter configured in `src/db.ts`.

Call `generatePublicCode(prisma)` from `src/public-code.ts` when report-creation logic is implemented. It reserves a number from PostgreSQL's sequence and returns `LPR-<year>-<number>`; the unique constraint on `reports.public_code` remains the final integrity guard. Sequence gaps are expected if a reserved code is not used.

## Docker

For local development, copy `.env.example` to `.env`, then run:

```sh
docker compose up --build
```

Compose starts PostgreSQL and the API, waits until PostgreSQL is healthy, applies migrations and the repeatable category seed, then starts Express. The API is available at `http://localhost:3000` and `GET /health` can be used to check it. PostgreSQL data is persisted in the `postgres_data` volume.

The credentials in `.env.example` are for local development only; change them before using this setup outside a local machine. Stop the containers with `docker compose down`. Removing the database volume with `docker compose down --volumes` permanently deletes local database data.
