import { mailer } from "../config/mailer";
import { env } from "../config/env";
import { ActionResult, DomainError } from "../domain/types";

export interface RecoveryEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendRecoveryEmail(
  params: RecoveryEmailParams,
): Promise<ActionResult> {
  try {
    const message = await mailer.sendMail({
      from: env.SMTP_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    return {
      actionType: "email",
      result: "success",
      integration: "EMAIL",
      emailMessageId: message.messageId,
    };
  } catch (error: unknown) {
    console.error("Recovery email delivery failed:", error);
    throw new DomainError(
      `Unable to send recovery email to ${params.to}.`,
      "RECOVERY_EMAIL_DELIVERY_FAILED",
      error,
    );
  }
}
