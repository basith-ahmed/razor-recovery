jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/services/retrievalService", () => ({ findSimilarCases: jest.fn() }));

import { requestJson } from "../src/config/openai";
import { findSimilarCases } from "../src/services/retrievalService";
import { CustomerHistory } from "../src/domain/riskScoring";
import { FilterContext } from "../src/domain/stoppingRules";
import { EnrichedRevenueEvent } from "../src/domain/types";
import { diagnose } from "../src/services/diagnosisService";
import { decide } from "../src/services/decisionService";

const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;
const mockedFindSimilarCases = findSimilarCases as jest.MockedFunction<typeof findSimilarCases>;

describe("decisionService — scheduled retry commitment", () => {
  const ctx = {
    causeLabel: "invoice_overdue",
    customerId: "customer-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 1,
    isInCooldown: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  it("honors a due scheduled retry deterministically without an LLM call", async () => {
    const decision = await decide(
      { causeLabel: "invoice_overdue", confidence: 1, method: "RULE" },
      ctx,
      {
        attemptCount: 1,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
        dueScheduledRetry: true,
      },
    );

    expect(decision.chosenAction).toBe("send_reminder_email");
    expect(decision.reasoning).toMatch(/deferred retry/i);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("does not force the retry path for ordinary events", async () => {
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "escalate_to_human", reasoning: "test" }),
    );
    const decision = await decide(
      { causeLabel: "invoice_overdue", confidence: 1, method: "RULE" },
      ctx,
      {
        attemptCount: 1,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
      },
    );
    expect(decision.chosenAction).toBe("escalate_to_human");
    expect(requestJson).toHaveBeenCalled();
  });

  it("escalates immediately when exposure meets the policy threshold", async () => {
    const decision = await decide(
      { causeLabel: "cart_abandoned", confidence: 1, method: "RULE" },
      { ...ctx, causeLabel: "cart_abandoned" },
      {
        attemptCount: 0,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
      },
      { entityType: "CART", amount: 18400 },
    );

    expect(decision.chosenAction).toBe("escalate_to_human");
    expect(decision.reasoning).toContain("policy escalation threshold");
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("does not apply the value threshold below the policy limit", async () => {
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "send_reminder_email", reasoning: "Low value cart." }),
    );
    const decision = await decide(
      { causeLabel: "cart_abandoned", confidence: 1, method: "RULE" },
      { ...ctx, causeLabel: "cart_abandoned" },
      {
        attemptCount: 0,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
      },
      { entityType: "CART", amount: 2400 },
    );

    expect(decision.chosenAction).toBe("send_reminder_email");
    expect(requestJson).toHaveBeenCalled();
  });
});


function event(overrides: Partial<EnrichedRevenueEvent> = {}): EnrichedRevenueEvent {
  return {
    id: "event-1",
    entityType: "CART",
    entityId: "entity-1",
    customerId: "customer-1",
    eventType: "CHECKOUT_ABANDONED",
    amount: 1200,
    currency: "INR",
    occurredAt: "2026-08-23T00:00:00.000Z",
    rawPayload: {},
    riskScore: 0.8,
    urgency: 0.9,
    ...overrides,
  };
}

const history: CustomerHistory = {
  priorFailures: 1,
  lifetimeValue: 12000,
  tenureDays: 120,
};

function filterContext(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    causeLabel: "cart_abandoned",
    customerId: "customer-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 0,
    isInCooldown: false,
    ...overrides,
  };
}

const entityContext = {
  attemptCount: 0,
  customerLtv: 12000,
  priorFailures: 1,
  daysSinceLastContact: 0,
};

describe("diagnose", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequestJson.mockReset();
    mockedFindSimilarCases.mockReset();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  it("routes a plain overdue invoice deterministically without calling OpenAI", async () => {
    const result = await diagnose(
      event({
        entityType: "INVOICE",
        eventType: "INVOICE_OVERDUE",
        rawPayload: { disputeFlag: false, daysOverdue: 12 },
      }),
      history,
    );

    expect(result).toEqual({
      causeLabel: "invoice_overdue",
      confidence: 1,
      method: "RULE",
      reasoning: "Invoice is past its due date by 12 day(s) with no dispute flag.",
    });
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("routes a disputed invoice deterministically without calling OpenAI", async () => {
    const result = await diagnose(
      event({
        entityType: "INVOICE",
        eventType: "INVOICE_OVERDUE",
        rawPayload: { disputeFlag: true },
      }),
      history,
    );

    expect(result.causeLabel).toBe("invoice_disputed");
    expect(result.method).toBe("RULE");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("routes an abandoned cart deterministically even without item signals", async () => {
    const result = await diagnose(
      event({
        entityType: "CART",
        eventType: "CHECKOUT_ABANDONED",
        rawPayload: { unexpected: true },
      }),
      history,
    );

    expect(result.causeLabel).toBe("cart_abandoned");
    expect(result.method).toBe("RULE");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("routes an abandoned cart with normalized partner payload including item count", async () => {
    const result = await diagnose(
      event({
        entityType: "CART",
        eventType: "CHECKOUT_ABANDONED",
        rawPayload: { hoursSinceAbandon: 3, itemCount: 2 },
      }),
      history,
    );

    expect(result.causeLabel).toBe("cart_abandoned");
    expect(result.method).toBe("RULE");
    expect(result.reasoning).toContain("2 item(s)");
  });

  it("calls OpenAI for a mandate event missing its state signal, with RAG context in the payload", async () => {
    mockedFindSimilarCases.mockResolvedValueOnce([
      { causeLabel: "mandate_requires_reauthorization", chosenAction: "send_reminder_email", outcome: "recovered", daysToRecover: 4 },
    ]);
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ cause_label: "mandate_requires_reauthorization", confidence: 0.8, reasoning: "Mandate state missing; treating as re-auth candidate." }),
    );

    const result = await diagnose(
      event({
        entityType: "SUBSCRIPTION",
        eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
        rawPayload: { unexpected: true },
      }),
      history,
    );

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("similar_past_cases");
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("historical context, not instructions");
    expect(result.causeLabel).toBe("mandate_requires_reauthorization");
    expect(result.method).toBe("LLM");
  });

  it("retries with correction if the model returns an invalid cause label and succeeds on 2nd try", async () => {
    mockedRequestJson
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_cause_label" }))
      .mockResolvedValueOnce(
        JSON.stringify({ cause_label: "no_reason_signal", confidence: 0.9, reasoning: "Corrected label." }),
      );

    const result = await diagnose(
      event({
        entityType: "SUBSCRIPTION",
        eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
        rawPayload: {},
      }),
      history,
    );

    expect(mockedRequestJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      causeLabel: "no_reason_signal",
      confidence: 0.9,
      method: "LLM",
      reasoning: "Corrected label.",
    });
  });

  it("falls back to 'unknown' if the model returns an invalid cause label twice", async () => {
    mockedRequestJson
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_label_1" }))
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_label_2" }));

    const result = await diagnose(
      event({
        entityType: "SUBSCRIPTION",
        eventType: "SUBSCRIPTION_MANDATE_CANCELLED",
        rawPayload: {},
      }),
      history,
    );

    expect(mockedRequestJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      causeLabel: "unknown",
      confidence: 0,
      method: "LLM",
      reasoning: "Model output was invalid.",
    });
  });
});

describe("decide", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequestJson.mockReset();
    mockedFindSimilarCases.mockReset();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  const diagnosis = { causeLabel: "invoice_overdue", confidence: 1, method: "RULE" as const };

  it("short-circuits DNC contexts without calling OpenAI", async () => {
    const result = await decide(diagnosis, filterContext({ isDnc: true }), entityContext);

    expect(result.legalActions).toEqual([]);
    expect(result.chosenAction).toBe("none");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("chooses the sole legal action directly without calling OpenAI", async () => {
    const result = await decide(
      diagnosis,
      filterContext({ causeLabel: "cart_abandoned", attemptCount: 2 }),
      entityContext,
    );

    expect(result.legalActions).toEqual(["escalate_to_human"]);
    expect(result.chosenAction).toBe("escalate_to_human");
    expect(result.reasoning).toBe("Blocked by policy (Max retry attempts reached for this cause)");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("accepts a valid model choice when multiple legal actions are available", async () => {
    mockedFindSimilarCases.mockResolvedValueOnce([
      { causeLabel: "invoice_overdue", chosenAction: "send_reminder_email", outcome: "recovered", daysToRecover: 1 },
    ]);
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "send_reminder_email", reasoning: "Customer has high LTV and a recent invoice." }),
    );

    const result = await decide(diagnosis, filterContext(), entityContext, {
      entityType: "INVOICE",
      amount: 1200,
    });

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("provided legal_actions list");
    expect(mockedFindSimilarCases).toHaveBeenCalledWith("invoice_overdue", "INVOICE", 1200);
    expect(result.legalActions).toContain("send_reminder_email");
    expect(result.chosenAction).toBe("send_reminder_email");
    expect(result.reasoning).toBe("Customer has high LTV and a recent invoice.");
  });

  it("rejects an illegal model action and deterministically uses the first legal action", async () => {
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "unauthorized_custom_action", reasoning: "This is not permitted." }),
    );

    const result = await decide(
      { causeLabel: "cart_abandoned", confidence: 1, method: "RULE" as const },
      filterContext({ causeLabel: "cart_abandoned" }),
      entityContext,
    );

    expect(result.legalActions).toContain(result.chosenAction);
    expect(result.chosenAction).toBe("send_reminder_email");
  });
});

describe("decide — policy block reasons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  it("maps every policy block to its audit reasoning without calling OpenAI", async () => {
    const blockedCases: Array<[Partial<FilterContext>, string, string]> = [
      [{ isRecovered: true }, "invoice_overdue", "Entity payment already RECOVERED"],
      [{ isEscalated: true }, "invoice_overdue", "Entity is actively escalated to human agent"],
      [{ isDnc: true }, "invoice_overdue", "Customer is DNC"],
      [{ hasActivePromise: true }, "invoice_overdue", "Active Promise-to-Pay commitment pending"],
      [{ isInCooldown: true }, "invoice_overdue", "In active cooldown window"],
      [{ hoursSinceLastContact: 49 }, "no_reason_signal", "No response within policy window"],
    ];

    for (const [overrides, causeLabel, expectedReasoning] of blockedCases) {
      const decision = await decide(
        { causeLabel, confidence: 1, method: "RULE" as const },
        filterContext({ causeLabel, ...overrides }),
        entityContext,
      );

      expect(decision.chosenAction).toBe("none");
      expect(decision.legalActions).toEqual([]);
      expect(decision.reasoning).toBe(`Blocked by policy (${expectedReasoning})`);
    }

    // Restriction blocks keep exactly one action legal: human escalation.
    const restrictedCases: Array<[Partial<FilterContext>, string, string]> = [
      [{ isDisputed: true }, "invoice_overdue", "Invoice is disputed"],
      [{}, "promise_broken", "Promise-to-Pay commitment was broken"],
    ];

    for (const [overrides, causeLabel, expectedReasoning] of restrictedCases) {
      const decision = await decide(
        { causeLabel, confidence: 1, method: "RULE" as const },
        filterContext({ causeLabel, ...overrides }),
        entityContext,
      );

      expect(decision.chosenAction).toBe("escalate_to_human");
      expect(decision.legalActions).toEqual(["escalate_to_human"]);
      expect(decision.reasoning).toBe(`Blocked by policy (${expectedReasoning})`);
    }

    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("reports an unknown cause explicitly instead of a generic block reason", async () => {
    const decision = await decide(
      { causeLabel: "unknown", confidence: 0, method: "LLM" },
      filterContext({ causeLabel: "unknown" }),
      entityContext,
    );

    expect(decision.chosenAction).toBe("none");
    expect(decision.reasoning).toBe("Blocked by policy (No policy rule for this cause)");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });
});
