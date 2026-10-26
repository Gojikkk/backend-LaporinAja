import type { PrismaClient } from "@prisma/client";

export async function generatePublicCode(prisma: PrismaClient): Promise<string> {
  const [sequence] = await prisma.$queryRaw<{ value: bigint }[]>`
    SELECT nextval('report_public_code_seq') AS value
  `;

  return `LPR-${new Date().getFullYear()}-${sequence.value.toString().padStart(6, "0")}`;
}
