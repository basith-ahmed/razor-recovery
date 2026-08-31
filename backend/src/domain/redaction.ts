const SENSITIVE_FIELD_NAMES = new Set([
  "email",
  "customeremail",
  "contactemail",
  "phone",
  "customerphone",
  "contactphone",
]);

export function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  return `${email[0]}***${email.slice(atIndex)}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return "*".repeat(digits.length - 4) + digits.slice(-4);
}

export function redactPII(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactPII);
  }
  if (value !== null && typeof value === "object") {
    // Preserve instances of Date, Error, etc., or plain objects
    if (value instanceof Date) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELD_NAMES.has(lowerKey) && typeof v === "string") {
        out[key] = lowerKey.includes("email") ? maskEmail(v) : maskPhone(v);
      } else {
        out[key] = redactPII(v);
      }
    }
    return out;
  }
  return value;
}
