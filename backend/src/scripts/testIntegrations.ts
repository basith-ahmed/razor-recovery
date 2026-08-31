import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { sendRecoveryEmail } from "../integrations/emailIntegration";
import { createRecoveryPaymentLink } from "../integrations/razorpayIntegration";
import { escalateToHuman } from "../integrations/ticketMock";

async function main(): Promise<void> {
  const email = await sendRecoveryEmail({
    to: env.SMTP_FROM,
    subject: "RazorRecovery integration test",
    html: "<p>Recovery email integration test.</p>",
  });

  const ticket = await escalateToHuman(
    "phase4-integration-test",
    "Phase 4 persistence verification",
  );
  const persistedTicket = await prisma.ticket.findUnique({
    where: { id: ticket.detail },
  });

  if (!persistedTicket) {
    throw new Error("Ticket was not persisted.");
  }

  console.log(`Email message ID: ${email.emailMessageId}`);
  console.log(`Persisted ticket ID: ${persistedTicket.id}`);
  console.log("Open MailHog at http://localhost:8025 to inspect the email.");

  const paymentLink = await createRecoveryPaymentLink({
    amount: 1,
    currency: "INR",
    customerName: "RazorRecovery Test Customer",
    customerEmail: env.SMTP_FROM,
    description: "RazorRecovery integration test payment link",
  });

  console.log(`Payment link: ${paymentLink.paymentLinkUrl}`);
}

main().catch((error: unknown) => {
  console.error("Phase 4 integration test failed:", error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
