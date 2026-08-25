import { requestJson } from "../config/openai";
import { logError } from "../config/logger";
import { CustomerHistory } from "../domain/riskScoring";
import { DiagnosisResult, DomainError, EnrichedRevenueEvent } from "../domain/types";

export const CAUSE_LABELS = [
  "expired_card",
  "insufficient_funds",
  "gateway_timeout",
  "price_friction",
  "no_reason_signal",
  "subscription_renewal_failed",
  "invoice_overdue",
  "invoice_disputed",
  "dnc",
] as const;

export type CauseLabel = (typeof CAUSE_LABELS)[number];

/** Exact Razorpay `error_reason` values supplied by the Phase 3 simulator. */
export const CAUSE_MAP: Readonly<Record<string, CauseLabel>> = {
  insufficient_fund: "insufficient_funds",
  payment_timed_out: "gateway_timeout",
  card_expired: "expired_card",
  incorrect_card_details: "no_reason_signal",
  incorrect_otp: "no_reason_signal",
  payment_cancelled: "no_reason_signal",
  payment_declined: "gateway_timeout",
  invalid_vpa: "no_reason_signal",
  payment_risk_check_failed: "gateway_timeout",
  payment_failed: "gateway_timeout",
  gateway_technical_error: "gateway_timeout",
};

export const DIAGNOSIS_SYSTEM_PROMPT = `You are RazorRecovery's diagnosis service. Classify the revenue event into exactly one cause label. Do not recommend an action, contact a customer, or make policy decisions. Return JSON only with cause_label, confidence, and reasoning. cause_label must be one of: expired_card, insufficient_funds, gateway_timeout, price_friction, no_reason_signal, subscription_renewal_failed, invoice_overdue, invoice_disputed, dnc.`;

const diagnosisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cause_label", "confidence", "reasoning"],
  properties: {
    cause_label: { type: "string" },
    confidence: { type: "number" },
    reasoning: { type: "string" },
  },
};

interface DiagnosisOutput {
  cause_label?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

function parseJson(text: string): DiagnosisOutput | undefined {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value: unknown = JSON.parse(normalized);
    return value !== null && typeof value === "object" ? (value as DiagnosisOutput) : undefined;
  } catch {
    return undefined;
  }
}

function isCauseLabel(value: unknown): value is CauseLabel {
  return typeof value === "string" && CAUSE_LABELS.includes(value as CauseLabel);
}

function toResult(output: DiagnosisOutput): DiagnosisResult | undefined {
  if (!isCauseLabel(output.cause_label)) {
    return undefined;
  }

  return {
    causeLabel: output.cause_label,
    confidence:
      typeof output.confidence === "number" && Number.isFinite(output.confidence)
        ? Math.max(0, Math.min(1, output.confidence))
        : 0,
    method: "LLM",
    reasoning: typeof output.reasoning === "string" ? output.reasoning : "",
  };
}

function userPayload(event: EnrichedRevenueEvent, history: CustomerHistory) {
  return { event, history };
}

async function requestDiagnosis(input: string): Promise<string> {
  try {
    return await requestJson({
      instructions: DIAGNOSIS_SYSTEM_PROMPT,
      input,
      schemaName: "revenue_diagnosis",
      schema: diagnosisSchema,
    });
  } catch (cause) {
    logError("diagnosis", cause);
    throw new DomainError("Unable to diagnose revenue event.", "LLM_DIAGNOSIS_FAILED", cause);
  }
}

export async function diagnose(
  event: EnrichedRevenueEvent,
  history: CustomerHistory,
): Promise<DiagnosisResult> {
  const mappedCause =
    event.eventType === "PAYMENT_FAILED" && event.errorReason
      ? CAUSE_MAP[event.errorReason]
      : undefined;

  if (mappedCause) {
    return { causeLabel: mappedCause, confidence: 1, method: "RULE" };
  }

  const payload = JSON.stringify(userPayload(event, history));
  try {
    const raw1 = await requestDiagnosis(payload);
    const first = toResult(parseJson(raw1) ?? {});
    if (first) return first;

    console.error("Gemini returned an invalid diagnosis label; retrying with correction.");
    const raw2 = await requestDiagnosis(
      `${payload}\n\nCorrection: return a JSON object whose cause_label is exactly one of the allowed labels.`,
    );
    const corrected = toResult(parseJson(raw2) ?? {});
    if (corrected) return corrected;
  } catch (err) {
    console.error("Gemini diagnosis request failed; applying fallback rule diagnosis.");
    return {
      causeLabel: "no_reason_signal",
      confidence: 0.5,
      method: "RULE",
      reasoning: "LLM rate limited or unavailable; fallback to default rule.",
    };
  }

  console.error("Gemini returned an invalid diagnosis label after correction; using unknown.");
  return { causeLabel: "unknown", confidence: 0, method: "LLM", reasoning: "Model output was invalid." };
}
