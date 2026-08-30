import { filterLegalActions, FilterContext } from "../src/domain/stoppingRules";
import { diagnose } from "../src/services/diagnosisService";
import { nextState, canTransition } from "../src/domain/stateMachine";
import { decide } from "../src/services/decisionService";
import { EnrichedRevenueEvent, DiagnosisResult } from "../src/domain/types";

describe("Promise-to-Pay Tracker & Policy Engine", () => {
  describe("Stopping Rules with Promises", () => {
    it("suppresses automated recovery actions when customer has an active promise", () => {
      const ctx: FilterContext = {
        causeLabel: "invoice_overdue",
        customerId: "cust-1",
        isDnc: false,
        isDisputed: false,
        hasActivePromise: true,
        attemptCount: 0,
        isInCooldown: false,
      };

      const actions = filterLegalActions(ctx);
      expect(actions).toEqual([]);
    });

    it("immediately mandates escalate_to_human when cause is promise_broken", () => {
      const ctx: FilterContext = {
        causeLabel: "promise_broken",
        customerId: "cust-1",
        isDnc: false,
        isDisputed: false,
        attemptCount: 0,
        isInCooldown: false,
      };

      const actions = filterLegalActions(ctx);
      expect(actions).toEqual(["escalate_to_human"]);
    });

    it("allows standard invoice_overdue actions when no active promise exists", () => {
      const ctx: FilterContext = {
        causeLabel: "invoice_overdue",
        customerId: "cust-1",
        isDnc: false,
        isDisputed: false,
        hasActivePromise: false,
        attemptCount: 0,
        isInCooldown: false,
      };

      const actions = filterLegalActions(ctx);
      expect(actions).not.toContain("start_promise_to_pay_tracking");
      expect(actions).toContain("send_reminder_email");
      expect(actions).toContain("escalate_to_human");
    });
  });

  describe("Diagnosis for Broken Promises", () => {
    it("deterministically classifies errorReason 'promise_broken' as promise_broken cause", async () => {
      const event: EnrichedRevenueEvent = {
        id: "evt-broken-1",
        entityType: "INVOICE",
        entityId: "inv-1",
        customerId: "cust-1",
        eventType: "INVOICE_OVERDUE",
        amount: 25000,
        currency: "INR",
        occurredAt: new Date().toISOString(),
        errorReason: "promise_broken",
        rawPayload: {},
        riskScore: 0.8,
        urgency: 0.9,
      };

      const result = await diagnose(event, {
        priorFailures: 1,
        lifetimeValue: 100000,
        tenureDays: 120,
      });

      expect(result.causeLabel).toBe("promise_broken");
      expect(result.confidence).toBe(1);
      expect(result.method).toBe("RULE");
    });

    it("deterministically classifies synthesized followUp marker as promise_broken", async () => {
      const event: EnrichedRevenueEvent = {
        id: "evt-broken-2",
        entityType: "INVOICE",
        entityId: "inv-2",
        customerId: "cust-2",
        eventType: "INVOICE_OVERDUE",
        amount: 15000,
        currency: "INR",
        occurredAt: new Date().toISOString(),
        rawPayload: {
          synthesized: true,
          followUp: { type: "promise_broken", promiseId: "p-123" },
        },
        riskScore: 0.75,
        urgency: 0.85,
      };

      const result = await diagnose(event, {
        priorFailures: 0,
        lifetimeValue: 50000,
        tenureDays: 60,
      });

      expect(result.causeLabel).toBe("promise_broken");
      expect(result.confidence).toBe(1);
      expect(result.method).toBe("RULE");
    });
  });

  describe("Decision Engine with Promises", () => {
    it("returns chosenAction 'none' with clear reasoning when active promise is pending", async () => {
      const diagnosis: DiagnosisResult = {
        causeLabel: "invoice_overdue",
        confidence: 1,
        method: "RULE",
      };

      const filterCtx: FilterContext = {
        causeLabel: "invoice_overdue",
        customerId: "cust-1",
        isDnc: false,
        isDisputed: false,
        hasActivePromise: true,
        attemptCount: 0,
        isInCooldown: false,
      };

      const decision = await decide(diagnosis, filterCtx, {
        attemptCount: 0,
        customerLtv: 50000,
        priorFailures: 0,
        daysSinceLastContact: 1,
      });

      expect(decision.chosenAction).toBe("none");
      expect(decision.reasoning).toContain("Active Promise-to-Pay commitment pending");
    });

    it("chooses escalate_to_human when promise is broken", async () => {
      const diagnosis: DiagnosisResult = {
        causeLabel: "promise_broken",
        confidence: 1,
        method: "RULE",
      };

      const filterCtx: FilterContext = {
        causeLabel: "promise_broken",
        customerId: "cust-1",
        isDnc: false,
        isDisputed: false,
        attemptCount: 0,
        isInCooldown: false,
      };

      const decision = await decide(diagnosis, filterCtx, {
        attemptCount: 0,
        customerLtv: 50000,
        priorFailures: 1,
        daysSinceLastContact: 3,
      });

      expect(decision.chosenAction).toBe("escalate_to_human");
    });
  });

  describe("State Machine Transitions with Promises", () => {
    it("maps promise_tracked outcome to CONTACTED state", () => {
      const state = nextState("DETECTED", "promise_tracked");
      expect(state).toBe("CONTACTED");
      expect(canTransition("DETECTED", "CONTACTED")).toBe(true);
    });
  });
});
