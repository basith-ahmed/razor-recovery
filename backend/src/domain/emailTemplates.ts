export interface EmailTemplateContext {
  customerName: string;
  amount: number;
  currency?: string;
  entityId: string;
  entityType?: string;
  eventType?: string;
  errorReason?: string;
  errorCode?: string;
  cause?: string;
  actionType?: string;
  paymentLinkUrl?: string;
  winbackDiscountPercent?: number;
}

/**
 * Standard branded HTML email layout for all RazorRecovery communications.
 */
export function buildEmailTemplate(paragraphs: string[], amount?: number, paymentLinkUrl?: string): string {
  const contentHtml = paragraphs.map((p) => `<p style="margin-bottom: 16px; line-height: 1.5;">${p}</p>`).join("");
  const buttonHtml = paymentLinkUrl && amount !== undefined
    ? `<div style="text-align: center; margin: 32px 0;">
         <a href="${paymentLinkUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Pay ₹${amount.toLocaleString("en-IN")} Now</a>
       </div>`
    : paymentLinkUrl
    ? `<div style="text-align: center; margin: 32px 0;">
         <a href="${paymentLinkUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">Complete Payment Now</a>
       </div>`
    : "";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
      <h2 style="color: #2563eb; margin-top: 0; margin-bottom: 20px; font-size: 20px; font-weight: 700;">RazorRecovery</h2>
      ${contentHtml}
      ${buttonHtml}
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
      <p style="font-size: 12px; color: #64748b; margin: 0;">
        This is an automated message from RazorRecovery. If you have already completed this payment, please ignore this email.
      </p>
    </div>
  `;
}

function getEntityRef(ctx: EmailTemplateContext): string {
  const shortId = ctx.entityId.slice(-6);
  if (ctx.entityType === "INVOICE" || ctx.eventType === "INVOICE_OVERDUE") {
    return `Invoice #${shortId}`;
  }
  if (ctx.entityType === "SUBSCRIPTION" || ctx.eventType === "SUBSCRIPTION_MANDATE_CANCELLED") {
    return `Subscription #${shortId}`;
  }
  if (ctx.entityType === "CART" || ctx.eventType === "CHECKOUT_ABANDONED") {
    return `Order #${shortId}`;
  }
  return `Ref #${shortId}`;
}

/**
 * Pre-compiled, parameterized email templates for all failure and dunning causes.
 * `ctaAmount` overrides the amount shown on the payment button when the offer
 * itself changes what the customer pays (e.g. winback discount).
 */
export function getEmailTemplate(ctx: EmailTemplateContext): {
  subject: string;
  paragraphs: string[];
  ctaAmount?: number;
} {
  const entityRef = getEntityRef(ctx);
  const formattedAmount = `₹${ctx.amount.toLocaleString("en-IN")}`;
  const key = (ctx.cause || ctx.errorReason || ctx.eventType || ctx.actionType || "").toLowerCase();

  // 1. Expired Card
  if (key.includes("expired_card") || key === "card_expired") {
    return {
      subject: `Action Required: Update card details for payment of ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `We were unable to process your payment of ${formattedAmount} for ${entityRef} because the payment card on file has expired.`,
        `Please click the link below to update your payment details or complete the transaction with an active card or UPI.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 2. Insufficient Funds
  if (key.includes("insufficient_fund") || key === "insufficient_funds") {
    return {
      subject: `Payment Unsuccessful: Retry your payment of ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `Your recent payment of ${formattedAmount} for ${entityRef} could not be completed due to insufficient balance in your account.`,
        `You can easily retry the payment or use an alternate payment method (UPI, Card, Netbanking) using the secure link below.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 3. Gateway / Network Timeout
  if (key.includes("gateway_timeout") || key.includes("timed_out") || key.includes("technical_error")) {
    return {
      subject: `Payment Pending: Complete your payment of ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `Your payment of ${formattedAmount} for ${entityRef} encountered a temporary bank network timeout during processing.`,
        `We have verified that your transaction is safe. Please use the secure link below to complete your payment.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // Winback retention offer (subscription customers judged high-value by the decision LLM)
  if (ctx.actionType === "send_winback_offer") {
    const discount = ctx.winbackDiscountPercent ?? 20;
    const discountedAmount = Math.round(ctx.amount * (1 - discount / 100));
    return {
      subject: `We'd love to keep you — ${discount}% off ${entityRef}`,
      ctaAmount: discountedAmount,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `We noticed your subscription auto-debit for ${entityRef} (${formattedAmount}) needs re-authorization, and we'd hate to lose you.`,
        `As a valued customer, we're offering you an exclusive ${discount}% discount on your upcoming period — bringing it down to ₹${discountedAmount.toLocaleString("en-IN")} — if you re-authorize now.`,
        `Click the button below to re-authorize your mandate and claim your discount before your subscription is interrupted.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 1. Mandate Re-Authorization (UPI Autopay / e-NACH cancelled or halted)
  if (
    key.includes("mandate_requires_reauthorization") ||
    key.includes("mandate_cancelled") ||
    key.includes("subscription_halted")
  ) {
    return {
      subject: `Action Required: Re-authorize your subscription auto-debit of ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `Your recurring auto-debit subscription for ${entityRef} (${formattedAmount}) requires your attention. Your UPI Autopay / e-NACH mandate needs to be re-authorized to keep your subscription active without interruption.`,
        `Please click the button below to securely re-authorize your mandate or switch to a new payment method.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 2. Abandoned Cart
  if (
    key.includes("cart_abandoned") ||
    key.includes("checkout_abandoned") ||
    ctx.eventType === "CHECKOUT_ABANDONED"
  ) {
    return {
      subject: `Complete your checkout for ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `We noticed you left items in your cart (Total: ${formattedAmount}). Your selection is currently reserved.`,
        `You can complete your checkout quickly and securely using the link below.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 3. Soft Chase Dunning (attempt 2 — must be checked before cause templates
  //    so the dunning ladder's escalation tone actually reaches the customer)
  if (ctx.actionType === "send_soft_chase_email" || key.includes("soft_chase")) {
    return {
      subject: `Follow-up: Outstanding payment for ${entityRef} (${formattedAmount})`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `We are following up on our previous notice regarding outstanding ${entityRef} for ${formattedAmount}.`,
        `To ensure uninterrupted service and account standing, please process the payment via the secure link below.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 4. Overdue B2B Invoice / first reminder
  if (
    key.includes("invoice_overdue") ||
    ctx.eventType === "INVOICE_OVERDUE" ||
    ctx.actionType === "send_reminder_email"
  ) {
    return {
      subject: `Friendly Reminder: Overdue ${entityRef} for ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `This is a friendly reminder that ${entityRef} for ${formattedAmount} is currently past its payment due date.`,
        `Please review and process the invoice payment using the button below.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 5. Promise to Pay Follow-Up
  if (key.includes("promise_broken") || key.includes("promise_to_pay")) {
    return {
      subject: `Payment Follow-up: Promised commitment of ${formattedAmount}`,
      paragraphs: [
        `Hi ${ctx.customerName},`,
        `We are following up regarding your payment commitment of ${formattedAmount} for ${entityRef}.`,
        `Please click the button below to complete your payment.`,
        `Best regards,<br/>The RazorRecovery Team`,
      ],
    };
  }

  // 6. Default General Revenue Recovery
  return {
    subject: `Action Required: Pending payment of ${formattedAmount}`,
    paragraphs: [
      `Hi ${ctx.customerName},`,
      `We noticed a pending payment of ${formattedAmount} for ${entityRef}. Please update your payment method or complete the payment at your earliest convenience.`,
      `Best regards,<br/>The RazorRecovery Team`,
    ],
  };
}

/**
 * Generates recovery email using pre-generated templates with dynamic variable interpolation.
 */
export function generateRecoveryEmail(ctx: EmailTemplateContext): { subject: string; html: string } {
  const { subject, paragraphs, ctaAmount } = getEmailTemplate(ctx);
  const html = buildEmailTemplate(paragraphs, ctaAmount ?? ctx.amount, ctx.paymentLinkUrl);
  return { subject, html };
}

export function buildPromiseConfirmationEmail(params: {
  customerName: string;
  amount: number;
  promisedDate: Date | string;
  paymentLinkUrl?: string;
}): { subject: string; html: string } {
  const dateObj = params.promisedDate instanceof Date ? params.promisedDate : new Date(params.promisedDate);
  const formattedDate = isNaN(dateObj.getTime()) ? String(params.promisedDate) : dateObj.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const subject = `Promise-to-Pay Commitment Confirmation: ₹${params.amount.toLocaleString("en-IN")} due by ${formattedDate}`;
  const html = buildEmailTemplate(
    [
      `Hi ${params.customerName},`,
      `Thank you for confirming your commitment to pay. We have recorded your promise to settle ₹${params.amount.toLocaleString("en-IN")} on or before <strong>${formattedDate}</strong>.`,
      `You can complete your payment securely anytime before the due date using the button below:`,
      `If you have any questions or require an adjustment to your schedule, please feel free to reply to this email.`,
      `Best regards,<br/>The RazorRecovery Team`,
    ],
    params.amount,
    params.paymentLinkUrl,
  );
  return { subject, html };
}

export function buildPromiseReminderEmail(params: {
  customerName: string;
  amount: number;
  promisedDate: Date | string;
  paymentLinkUrl?: string;
}): { subject: string; html: string } {
  const dateObj = params.promisedDate instanceof Date ? params.promisedDate : new Date(params.promisedDate);
  const formattedDate = isNaN(dateObj.getTime()) ? String(params.promisedDate) : dateObj.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const subject = `Urgent Follow-Up: Pending Promise-to-Pay for ₹${params.amount.toLocaleString("en-IN")}`;
  const html = buildEmailTemplate(
    [
      `Hi ${params.customerName},`,
      `This is a follow-up regarding your agreed Promise-to-Pay commitment of ₹${params.amount.toLocaleString("en-IN")}, which was due on <strong>${formattedDate}</strong>.`,
      `Our records show that this payment has not yet been completed. Please use the button below to settle the outstanding balance immediately:`,
      `If you need assistance or have already made this payment, please contact us right away.`,
      `Best regards,<br/>The RazorRecovery Team`,
    ],
    params.amount,
    params.paymentLinkUrl,
  );
  return { subject, html };
}

/**
 * Builds custom email outreach sent by a human agent from an escalation ticket.
 */
export function buildTicketOutreachEmail(params: {
  customerName: string;
  message: string;
  amount?: number;
  paymentLinkUrl?: string;
}): { subject: string; html: string } {
  const subject = `Regarding your account payment`;
  const paragraphs = params.message.split("\n").filter((p) => p.trim().length > 0);
  const html = buildEmailTemplate(paragraphs, params.amount, params.paymentLinkUrl);
  return { subject, html };
}
