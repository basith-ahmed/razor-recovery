import { prisma } from "../config/prisma";

async function main() {
  const count = await prisma.auditEntry.count();
  if (count === 0) {
    console.log("No audit entries in the database.");
    return;
  }

  const randomSkip = Math.floor(Math.random() * count);
  const entry = await prisma.auditEntry.findFirst({
    skip: randomSkip,
  });

  if (!entry) {
    console.log("Could not find an audit entry.");
    return;
  }

  const newOutcome = entry.outcome === "tampered_data" ? "tampered_override" : "tampered_data";

  await prisma.auditEntry.update({
    where: { id: entry.id },
    data: {
      outcome: newOutcome,
    },
  });

  console.log(`Tampered Sequence #${entry.sequenceNumber} (ID: ${entry.id})`);
  console.log(`Changed outcome from "${entry.outcome}" to "${newOutcome}"`);
}

main().finally(() => prisma.$disconnect());
