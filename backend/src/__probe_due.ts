import { prisma } from "./config/prisma";
import { selectDueFollowUps } from "./scheduler/followUpScheduler";
async function main() {
  const arcs = await prisma.entityWorkflowState.findMany({ select: { entityId: true, state: true } });
  const counts: Record<string, number> = {};
  for (const a of arcs) counts[a.state] = (counts[a.state] ?? 0) + 1;
  console.log("arc states:", counts);
  const causeStates = await prisma.entityCauseState.findMany();
  const now = new Date();
  console.log("due follow-ups right now:", selectDueFollowUps(arcs, causeStates, now).length);
  await prisma.$disconnect();
}
main();
