import { describe, expect, it } from "vitest";
import { buildRegistrationPayload, newRegistrationKey, type RegistrationFields } from "./registration";

const fields = {
  fullName: "Demo Owner", email: "owner@example.com", phone: "", password: "a-long-password-123",
  tradeName: "Demo Cafe", registeredBusinessName: "", businessType: "cafe",
  pan: "", gstin: "", cin: "", fssaiLicense: "", websiteUrl: "", businessEmail: "", businessPhone: "",
  businessAddressLine1: "12 Main Road", businessAddressLine2: "", businessLocality: "",
  businessCity: "Bengaluru", businessDistrict: "", businessState: "Karnataka", businessStateCode: "29",
  businessPostalCode: "560001", outletName: "Demo Cafe - Main", outletCode: "", outletPhone: "",
  outletEmail: "", outletAddressLine1: "12 Main Road", outletAddressLine2: "", outletLocality: "",
  outletCity: "Bengaluru", outletDistrict: "", outletState: "Karnataka", outletStateCode: "29",
  outletPostalCode: "560001", outletGstin: "", outletFssaiLicense: "",
} satisfies RegistrationFields;

describe("registration payload", () => {
  it("matches the API's nested owner, business and outlet contract", () => {
    const payload = buildRegistrationPayload(fields);
    expect(payload.business.address.countryCode).toBe("IN");
    expect(payload.outlet.address.city).toBe("Bengaluru");
    expect(payload.acceptedTerms).toBe(true);
    expect(payload.termsVersion).toBe("2026-11");
    expect(payload.business).not.toHaveProperty("pan");
    expect(payload.business).not.toHaveProperty("gstin");
  });

  it("normalizes optional tax identifiers and omits blank optional values", () => {
    const payload = buildRegistrationPayload({ ...fields, pan: "abcde1234f", gstin: "29ABCDE1234F1Z5" });
    expect(payload.business.pan).toBe("ABCDE1234F");
    expect(payload.business.gstin).toBe("29ABCDE1234F1Z5");
    expect(payload.business).not.toHaveProperty("cin");
  });

  it("creates a URL-safe idempotency key accepted by the API", () => {
    expect(newRegistrationKey()).toMatch(/^fdreg_[A-Za-z0-9-]{30,}$/);
  });
});
