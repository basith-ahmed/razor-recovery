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
  onMaxEscalate?: boolean;
  onMaxAction?: string;
  noResponseWithinHours?: number;
  onTimeoutAction?: string;
  hardStopDays?: number;
  onHardStopAction?: string;
  escalateAtDays?: number;
  always?: boolean;
  freezeWorkflow?: boolean;
  overridesAll?: boolean;
  skipAndLog?: boolean;
  checkedFirst?: boolean;
}

export interface PolicyRule {
  cause: string;
  actions: string[];
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

export function getPolicyVersion(): string {
  return loadPolicy().version;
}

/**
 * Reset the cached policy — used only in tests to ensure a clean state.
 */
export function _resetCache(): void {
  cachedPolicy = null;
}
