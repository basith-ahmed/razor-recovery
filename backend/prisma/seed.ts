import { prisma } from "../src/config/prisma";
import { seedEntities } from "../src/simulator/seedEntities";
import { GENESIS_HASH } from "../src/domain/hashChain";

async function main(): Promise<void> {
  await prisma.auditChainHead.upsert({
    where: { id: 1 },
    create: { id: 1, hash: GENESIS_HASH },
    update: {},
  });
  await seedEntities({ customers: 50 });
  console.log("Seeded 50 simulator customers with related entities and initialized AuditChainHead.");
}

main()
  .catch((error: unknown) => {
    console.error("Failed to seed simulator entities:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
