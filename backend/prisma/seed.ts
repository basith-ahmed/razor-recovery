import { prisma } from "../src/config/prisma";
import { seedEntities } from "../src/simulator/seedEntities";

async function main(): Promise<void> {
  await seedEntities({ customers: 50 });
  console.log("Seeded 50 simulator customers with related entities.");
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed simulator entities:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
