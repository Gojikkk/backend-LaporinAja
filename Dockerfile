FROM node:22-alpine

WORKDIR /app

ENV DATABASE_URL="postgresql://laporinaja:laporinaja_dev@db:5432/laporinaja?schema=public"

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src

RUN npm run prisma:generate && npm run build

EXPOSE 3000

CMD ["sh", "-c", "npm run db:deploy && npm run db:seed && npm start"]
