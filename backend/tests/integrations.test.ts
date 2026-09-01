import { sendRecoveryEmail } from "../src/integrations/emailIntegration";
import { createRecoveryPaymentLink } from "../src/integrations/razorpayIntegration";
import { escalateToHuman } from "../src/integrations/ticketMock";
import { prisma } from "../src/config/prisma";
import { mailer } from "../src/config/mailer";
import { razorpay } from "../src/config/razorpay";
import { DomainError } from "../src/domain/types";

describe("Integration Layer (Phase 4)", () => {
  describe("emailIntegration", () => {
    it("sends recovery email using mailer transport", async () => {
      const mockMessageId = "<test-id-123@razorrecovery.demo>";
      jest.spyOn(mailer, "sendMail").mockResolvedValueOnce({
        messageId: mockMessageId,
      } as any);

      const res = await sendRecoveryEmail({
        to: "test@example.com",
        subject: "Test Subject",
        html: "<p>Test Content</p>",
      });

      expect(res).toEqual({
        actionType: "email",
        result: "success",
        integration: "EMAIL",
        emailMessageId: mockMessageId,
      });
    });

    it("throws DomainError on mailer failure", async () => {
      jest.spyOn(mailer, "sendMail").mockRejectedValueOnce(new Error("SMTP failure"));

      await expect(
        sendRecoveryEmail({
          to: "fail@example.com",
          subject: "Fail",
          html: "Fail",
        })
      ).rejects.toThrow(DomainError);
    });
  });

  describe("ticketMock", () => {
    it("escalates to human by creating a ticket DB row", async () => {
      const testEntityId = "entity-unit-test-123";
      const testReason = "Manual review needed";

      const res = await escalateToHuman(testEntityId, testReason);

      expect(res.actionType).toBe("escalate_to_human");
      expect(res.result).toBe("success");
      expect(res.integration).toBe("TICKET");
      expect(res.detail).toBeDefined();

      const ticket = await prisma.ticket.findUnique({
        where: { id: res.detail },
      });

      expect(ticket).not.toBeNull();
      expect(ticket?.entityId).toBe(testEntityId);
      expect(ticket?.reason).toBe(testReason);
      expect(ticket?.status).toBe("open");

      // Cleanup
      if (ticket) {
        await prisma.ticket.delete({ where: { id: ticket.id } });
      }
    });

    it("throws DomainError if prisma fails", async () => {
      jest.spyOn(prisma.ticket, "create").mockRejectedValueOnce(new Error("DB error"));

      await expect(escalateToHuman("entity-fail", "reason-fail")).rejects.toThrow(DomainError);
    });
  });

  describe("razorpayIntegration", () => {
    it("creates recovery payment link with paise amount and notifications enabled", async () => {
      const mockPaymentLink = {
        id: "plink_test_12345",
        short_url: "https://rzp.io/i/test12345",
      };

      const createSpy = jest
        .spyOn(razorpay.paymentLink, "create")
        .mockResolvedValueOnce(mockPaymentLink as any);

      const res = await createRecoveryPaymentLink({
        amount: 150.5,
        currency: "INR",
        customerName: "Test Customer",
        customerEmail: "customer@example.com",
        customerPhone: "+919876543210",
        description: "Payment Link Test",
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 15050, // 150.5 * 100
          currency: "INR",
          description: "Payment Link Test",
          customer: {
            name: "Test Customer",
            email: "customer@example.com",
            contact: "+919876543210",
          },
          notify: { sms: true, email: true },
          reminder_enable: true,
          notes: {},
        }),
      );

      expect(res).toEqual({
        actionType: "send_payment_link",
        result: "success",
        integration: "RAZORPAY",
        razorpayPaymentLinkId: "plink_test_12345",
        paymentLinkUrl: "https://rzp.io/i/test12345",
      });
    });

    it("throws DomainError when payment link creation fails", async () => {
      jest
        .spyOn(razorpay.paymentLink, "create")
        .mockRejectedValueOnce(new Error("API Error"));

      await expect(
        createRecoveryPaymentLink({
          amount: 10,
          currency: "INR",
          customerName: "Fail User",
          customerEmail: "fail@example.com",
          description: "Fail test",
        })
      ).rejects.toThrow(DomainError);
    });
  });
});
