import { Router, Request, Response } from "express";
import {
  verifyWebhookSignature,
  processRazorpayPaymentWebhook,
} from "../../services/webhookService";
import { handleRouteError } from "../../utils/apiResponse";

export { verifyWebhookSignature };

export const razorpayWebhookRouter = Router();

/**
 * Express handler for inbound Razorpay webhooks.
 * Validates HMAC SHA256 signature and delegates settlement to webhookService.
 */
export async function handleRazorpayWebhook(req: Request, res: Response): Promise<Response> {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = (req as any).rawBody
    ? (req as any).rawBody
    : typeof req.body === "string"
    ? req.body
    : JSON.stringify(req.body);

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[razorpayWebhook] Signature verification failed.");
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const result = await processRazorpayPaymentWebhook(payload);
    return res.status(200).json({ ...result, status: "ok", processed: true });
  } catch (error: unknown) {
    console.error("[razorpayWebhook] Internal error processing webhook:", error);
    return handleRouteError(res, error, "Internal error processing webhook");
  }
}

razorpayWebhookRouter.post("/", handleRazorpayWebhook);
