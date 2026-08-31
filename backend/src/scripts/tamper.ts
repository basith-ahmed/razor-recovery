import { prisma } from "../config/prisma";
import { computeEntryHash, GENESIS_HASH, HashableEntry } from "../domain/hashChain";

async function main() {
  const args = process.argv.slice(2);

  // If user passes --fix or --restore or --repair, repair all hashes back to valid state
  if (args.includes("--fix") || args.includes("--restore") || args.includes("--repair")) {
    console.log("Restoring audit chain to 100% valid cryptographic state...");
    const rows = await prisma.auditEntry.findMany({
      orderBy: { sequenceNumber: "asc" },
    });

    if (rows.length === 0) {
      console.log("No audit entries in the database.");
      return;
    }

    let prevHash = rows[0].sequenceNumber === 1 ? GENESIS_HASH : rows[0].prevHash;
    let fixedCount = 0;

    for (const row of rows) {
      const normalOutcome =
        row.outcome.startsWith("tampered_") || row.outcome === "unauthorized_override"
          ? "pending"
          : row.outcome;
      const normalActor =
        row.actor === "unauthorized_sql_injector" ? "system" : row.actor;

      const hashable: HashableEntry = {
        eventId: row.eventId,
        entityId: row.entityId,
        actor: normalActor,
        inputSnapshot: row.inputSnapshot,
        diagnosisSnapshot: row.diagnosisSnapshot,
        decisionSnapshot: row.decisionSnapshot,
        actionSnapshot: row.actionSnapshot,
        outcome: normalOutcome,
        timestamp: row.timestamp.toISOString(),
      };

      const computedHash = computeEntryHash(prevHash, hashable);

      await prisma.auditEntry.update({
        where: { id: row.id },
        data: {
          actor: normalActor,
          outcome: normalOutcome,
          prevHash,
          hash: computedHash,
        },
      });

      prevHash = computedHash;
      fixedCount++;
    }

    // Update AuditChainHead
    await prisma.auditChainHead.upsert({
      where: { id: 1 },
      create: { id: 1, hash: prevHash },
      update: { hash: prevHash },
    });

    console.log(`✅ Repaired and verified ${fixedCount} audit entries.`);
    console.log("👉 Click 'Verify Audit Integrity' on the website now to see the green valid state!");
    return;
  }

  const count = await prisma.auditEntry.count();
  if (count === 0) {
    console.log("No audit entries in the database to tamper.");
    return;
  }

  let entry;
  const seqArg = args[0] ? parseInt(args[0], 10) : NaN;
  if (!isNaN(seqArg)) {
    entry = await prisma.auditEntry.findUnique({
      where: { sequenceNumber: seqArg },
    });
    if (!entry) {
      console.log(`Audit entry with sequence #${seqArg} not found.`);
      return;
    }
  } else {
    const randomSkip = Math.floor(Math.random() * count);
    entry = await prisma.auditEntry.findFirst({
      skip: randomSkip,
    });
  }

  if (!entry) {
    console.log("Could not find an audit entry.");
    return;
  }

  const newOutcome =
    entry.outcome === "tampered_data" ? "tampered_override" : "tampered_data";

  await prisma.auditEntry.update({
    where: { id: entry.id },
    data: {
      outcome: newOutcome,
    },
  });

  console.log(`⚠️ Tampered with Sequence #${entry.sequenceNumber} (Entity: ${entry.entityId}, ID: ${entry.id})`);
  console.log(`   Changed outcome from "${entry.outcome}" ➔ "${newOutcome}"`);
  console.log(`   (Stored SHA-256 hash was left unchanged in database to create verification breach)`);
  console.log("\n👉 Now click 'Verify Audit Integrity' on the website to see the violation at Sequence #" + entry.sequenceNumber);
  console.log("👉 To repair and make the chain green again, run: npm run tamper -- --fix");
}

main().finally(() => prisma.$disconnect());
