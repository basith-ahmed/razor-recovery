import { requestJson } from "../config/openai";
import { logError, renderError } from "../config/logger";
import { getPolicyVersion } from "../domain/policy";
import { FilterContext, filterLegalActions } from "../domain/stoppingRules";
import { DecisionResult, DiagnosisResult, DomainError } from "../domain/types";

export const DECISION_PROMPT = `You are RazorRecovery's decision service. Choose exactly one action from legal_actions. Never propose an action outside legal_actions and do not change policy. Return JSON only with chosen_action and reasoning.`;

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chosen_action", "reasoning"],
  properties: {
    chosen_action: { type: "string" },
    reasoning: { type: "string" },
  },
};

interface DecisionOutput {
  chosen_action?: unknown;
  reasoning?: unknown;
}

function parseDecision(text: string): DecisionOutput {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const value: unknown = JSON.parse(normalized);
    return value !== null && typeof value === "object" ? (value as DecisionOutput) : {};
  } catch {
    return {};
  }
}

async function requestDecision(input: string): Promise<string> {
  try {
    return await requestJson({
      instructions: DECISION_PROMPT,
      input,
      schemaName: "recovery_decision",
      schema: decisionSchema,
    });
  } catch (cause) {
    logError("decision", cause);
    throw new DomainError("Unable to select a recovery action.", "LLM_DECISION_FAILED", cause);
  }
}

export async function decide(
  diagnosis: DiagnosisResult,
  filterCtx: FilterContext,
  entityContext: {
    attemptCount: number;
    customerLtv: number;
    priorFailures: number;
    daysSinceLastContact: number;
  },
): Promise<DecisionResult> {
  const legalActions = filterLegalActions(filterCtx);
  const policyVersion = getPolicyVersion();

  if (legalActions.length === 0) {
    return { legalActions, chosenAction: "none", reasoning: "Blocked by policy (DNC or dispute)", policyVersion };
  }
  if (legalActions.length === 1) {
    return {
      legalActions,
      chosenAction: legalActions[0],
      reasoning: `Only legal action available: ${legalActions[0]}`,
      policyVersion,
    };
  }

  const payload = JSON.stringify({ diagnosis, legal_actions: legalActions, entity_context: entityContext });
  let rawResponse = "";
  try {
    rawResponse = await requestDecision(payload);
  } catch (err) {
    console.error("Gemini decision request failed; using deterministic fallback.", err);
    return {
      legalActions,
      chosenAction: legalActions[0],
      reasoning: "LLM rate limited or unavailable; selected first legal action.",
      policyVersion,
    };
  }

  const output = parseDecision(rawResponse);
  const chosenAction =
    typeof output.chosen_action === "string" && legalActions.includes(output.chosen_action)
      ? output.chosen_action
      : legalActions[0];

  if (chosenAction !== output.chosen_action) {
    console.error(
      `[decision] Gemini chose action "${output.chosen_action}" outside the legal set [${legalActions.join(", ")}]; using deterministic fallback.`,
    );
  }

  return {
    legalActions,
    chosenAction,
    reasoning: typeof output.reasoning === "string" ? output.reasoning : "Invalid model output; selected first legal action.",
    policyVersion,
  };
}
