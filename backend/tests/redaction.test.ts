import { redactPII, maskEmail, maskPhone } from "../src/domain/redaction";

describe("redaction domain module", () => {
  describe("maskEmail", () => {
    it("should mask standard email addresses", () => {
      expect(maskEmail("john.doe@example.com")).toBe("j***@example.com");
      expect(maskEmail("admin@razorrecovery.in")).toBe("a***@razorrecovery.in");
    });

    it("should handle edge cases", () => {
      expect(maskEmail("@example.com")).toBe("***");
      expect(maskEmail("")).toBe("***");
    });
  });

  describe("maskPhone", () => {
    it("should mask phone numbers keeping only the last 4 digits", () => {
      expect(maskPhone("+919876543210")).toBe("********3210");
      expect(maskPhone("9876543210")).toBe("******3210");
    });

    it("should handle short phone numbers", () => {
      expect(maskPhone("123")).toBe("***");
      expect(maskPhone("")).toBe("***");
    });
  });

  describe("redactPII", () => {
    it("should mask email and phone in a flat object", () => {
      const input = {
        name: "Aarav Sharma",
        email: "aarav.sharma@example.com",
        phone: "+919876543210",
        amount: 5000,
        currency: "INR",
        active: true,
      };

      const result = redactPII(input) as Record<string, unknown>;

      expect(result.email).toBe("a***@example.com");
      expect(result.phone).toBe("********3210");
      expect(result.name).toBe("Aarav Sharma");
      expect(result.amount).toBe(5000);
      expect(result.currency).toBe("INR");
      expect(result.active).toBe(true);
    });

    it("should recursively mask sensitive fields nested two levels deep", () => {
      const input = {
        id: "evt-001",
        customer: {
          profile: {
            customerEmail: "deep.nested@example.com",
            customerPhone: "9123456789",
            riskTier: "tier_1",
          },
          status: "active",
        },
        metadata: {
          contactEmail: "billing@company.com",
        },
      };

      const result = redactPII(input) as any;

      expect(result.customer.profile.customerEmail).toBe("d***@example.com");
      expect(result.customer.profile.customerPhone).toBe("******6789");
      expect(result.customer.profile.riskTier).toBe("tier_1");
      expect(result.customer.status).toBe("active");
      expect(result.metadata.contactEmail).toBe("b***@company.com");
      expect(result.id).toBe("evt-001");
    });

    it("should mask sensitive fields in arrays of objects", () => {
      const input = [
        { id: "1", email: "user1@test.com", score: 95 },
        { id: "2", email: "user2@test.com", score: 88 },
      ];

      const result = redactPII(input) as any[];

      expect(result).toHaveLength(2);
      expect(result[0].email).toBe("u***@test.com");
      expect(result[0].score).toBe(95);
      expect(result[1].email).toBe("u***@test.com");
      expect(result[1].score).toBe(88);
    });

    it("should leave non-sensitive objects and primitives completely untouched", () => {
      const primitiveNumber = 42;
      const primitiveString = "regular string";
      const primitiveNull = null;
      const primitiveUndefined = undefined;

      expect(redactPII(primitiveNumber)).toBe(42);
      expect(redactPII(primitiveString)).toBe("regular string");
      expect(redactPII(primitiveNull)).toBe(null);
      expect(redactPII(primitiveUndefined)).toBe(undefined);

      const nonSensitiveObj = { a: 1, b: "hello", c: [1, 2, 3] };
      expect(redactPII(nonSensitiveObj)).toEqual(nonSensitiveObj);
    });
  });
});
