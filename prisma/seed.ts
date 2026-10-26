import { prisma } from "../src/db";

const categories = [
  { name: "Jalan rusak", slug: "jalan-rusak" },
  { name: "Lampu jalan", slug: "lampu-jalan" },
  { name: "Sampah", slug: "sampah" },
  { name: "Saluran air", slug: "saluran-air" },
  { name: "Fasilitas umum", slug: "fasilitas-umum" },
  { name: "Lainnya", slug: "lainnya" }
];

async function main(): Promise<void> {
  for (const category of categories) {
    await prisma.reportCategory.upsert({
      where: { slug: category.slug },
      update: { name: category.name },
      create: category
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed report categories", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
