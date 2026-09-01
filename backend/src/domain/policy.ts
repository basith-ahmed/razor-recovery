/**
 * Policy loader — reads and caches policy.json in memory.
 * No network calls. Filesystem read happens once at load time.
 */

import * as fs from "fs";
import * as path from "path";

export interface StoppingConfig {
  maxAttempts?: number;
  windowDays?: number;
  windowHours?: number;
  onMaxAction?: string;
  noResponseWithinHours?: number;
  onTimeoutAction?: string;
  hardStopDays?: number;
  onHardStopAction?: string;
}

export interface PolicyRule {
  cause: string;
  actions: string[];
  /**
   * Value-based escalation trigger: when the exposure amount meets or exceeds
   * this threshold and escalation is a legal action, the decision service
   * short-circuits to escalate_to_human instead of running the standard
   * contact cadence.
   */
  escalateAboveAmount?: number;
  stopping: StoppingConfig;
}

export interface PolicyConfig {
  version: string;
  rules: PolicyRule[];
}

let cachedPolicy: PolicyConfig | null = null;

export function loadPolicy(): PolicyConfig {
  if (cachedPolicy) {
    return cachedPolicy;
  }

  const policyPath = path.join(__dirname, "policy.json");
  const raw = fs.readFileSync(policyPath, "utf-8");
  cachedPolicy = JSON.parse(raw) as PolicyConfig;
  return cachedPolicy;
}

export function getRuleForCause(cause: string): PolicyRule | undefined {
  const policy = loadPolicy();
  return policy.rules.find((r) => r.cause === cause);
}

export function cooldownTtlSeconds(causeLabel: string): number {
  const rule = getRuleForCause(causeLabel);
  if (!rule) return 3600; // 1h default

  const stopping = rule.stopping;
  if (stopping.windowHours !== undefined) {
    return stopping.windowHours * 3600;
  }
  if (stopping.windowDays !== undefined) {
    return stopping.windowDays * 86400;
  }
  return 3600; // 1h default
}

export function getPolicyVersion(): string {
  return loadPolicy().version;
}

/**
 * Reset the cached policy — used only in tests to ensure a clean state.
 */
export function _resetCache(): void {
  cachedPolicy = null;
}
