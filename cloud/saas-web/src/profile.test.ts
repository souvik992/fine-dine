import { describe, expect, it } from "vitest";
import { buildBusinessProfilePayload, type ProfileFields } from "./profile";

const profile = {
  tradeName: " Demo Cafe ",
  registeredBusinessName: "",
  businessType: "cafe",
  industry: "food_service",
  cin: "",
  fssaiLicense: "",
  websiteUrl: "",
  businessEmail: "",
  businessPhone: "",
  addressLine1: "12 Main Road",
  addressLine2: "",
  locality: "",
  city: "Bengaluru",
  district: "",
  state: "Karnataka",
  stateCode: "29",
  postalCode: "560001",
  countryCode: "IN",
  pan: "",
  gstin: "",
} satisfies ProfileFields;

describe("business profile payload", () => {
  it("omits blank tax identifiers so the API preserves saved values", () => {
    const payload = buildBusinessProfilePayload(profile);
    expect(payload).not.toHaveProperty("pan");
    expect(payload).not.toHaveProperty("gstin");
    expect(payload.address.countryCode).toBe("IN");
  });

  it("never sends masked account-summary values as replacements", () => {
    const payload = buildBusinessProfilePayload({
      ...profile,
      pan: "AB******CD",
      gstin: "29***********5",
    });
    expect(payload).not.toHaveProperty("pan");
    expect(payload).not.toHaveProperty("gstin");
  });

  it("sends only explicitly entered replacement tax IDs, normalized to uppercase", () => {
    const payload = buildBusinessProfilePayload({
      ...profile,
      pan: "abcde1234f",
      gstin: "29abcde1234f1z5",
    });
    expect(payload.pan).toBe("ABCDE1234F");
    expect(payload.gstin).toBe("29ABCDE1234F1Z5");
  });
});
