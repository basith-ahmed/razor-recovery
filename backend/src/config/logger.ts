/**
 * Minimal console logging helpers.
 *
 * Raw SDK/ORM error objects (Razorpay API errors, PrismaClientKnownRequestError,
 * axios configs, stacks) render as enormous multi-line dumps in the console.
 * These helpers render them as one or two concise lines instead. Nothing is
 * swallowed: every failure is still logged, and the full error remains captured
 * where it matters — the failed-state AuditEntry written by each stage.
 */

/** Extracts a compact one-line representation of an arbitrary thrown value. */
export function renderError(err: unknown): string {
  if (!(err instanceof Error)) {
    try {
      return `non-error value thrown: ${JSON.stringify(err)?.slice(0, 300) ?? String(err)}`;
    } catch {
      return `non-error value thrown: ${String(err)}`;
    }
  }

  let text = `${err.name}: ${err.message}`;

  // Common structured codes: Prisma (P2002…), Node system codes, HTTP statuses
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") {
    text += ` (code=${code})`;
  }

  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as { code?: unknown }).code;
    text += ` | caused by ${cause.name}: ${cause.message}`;
    if (typeof causeCode === "string" || typeof causeCode === "number") {
      text += ` (code=${causeCode})`;
    }
  }

  return text;
}

export function logError(context: string, err: unknown): void {
  console.error(`[${context}] ${renderError(err)}`);
}

export function logWarn(context: string, err: unknown): void {
  console.warn(`[${context}] ${renderError(err)}`);
}
