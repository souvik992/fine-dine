export type RegistrationFields = {
  fullName: string; email: string; phone: string; password: string;
  tradeName: string; registeredBusinessName: string; businessType: string;
  pan: string; gstin: string; cin: string; fssaiLicense: string; websiteUrl: string;
  businessEmail: string; businessPhone: string;
  businessAddressLine1: string; businessAddressLine2: string; businessLocality: string;
  businessCity: string; businessDistrict: string; businessState: string; businessStateCode: string;
  businessPostalCode: string;
  outletName: string; outletCode: string; outletPhone: string; outletEmail: string;
  outletAddressLine1: string; outletAddressLine2: string; outletLocality: string;
  outletCity: string; outletDistrict: string; outletState: string; outletStateCode: string;
  outletPostalCode: string; outletGstin: string; outletFssaiLicense: string;
};

const optional = (value: string) => value.trim() ? value.trim() : undefined;
const address = (fields: RegistrationFields, prefix: "business" | "outlet") => ({
  addressLine1: fields[`${prefix}AddressLine1`].trim(),
  ...(optional(fields[`${prefix}AddressLine2`]) ? { addressLine2: optional(fields[`${prefix}AddressLine2`]) } : {}),
  ...(optional(fields[`${prefix}Locality`]) ? { locality: optional(fields[`${prefix}Locality`]) } : {}),
  city: fields[`${prefix}City`].trim(),
  ...(optional(fields[`${prefix}District`]) ? { district: optional(fields[`${prefix}District`]) } : {}),
  state: fields[`${prefix}State`].trim(),
  ...(optional(fields[`${prefix}StateCode`]) ? { stateCode: optional(fields[`${prefix}StateCode`]) } : {}),
  postalCode: fields[`${prefix}PostalCode`].trim(),
  countryCode: "IN",
});

export function buildRegistrationPayload(f: RegistrationFields) {
  return {
    fullName: f.fullName.trim(), email: f.email.trim(), ...(optional(f.phone) ? { phone: optional(f.phone) } : {}),
    password: f.password,
    business: {
      tradeName: f.tradeName.trim(), ...(optional(f.registeredBusinessName) ? { registeredBusinessName: optional(f.registeredBusinessName) } : {}),
      businessType: f.businessType, industry: "food_service",
      ...(optional(f.pan) ? { pan: optional(f.pan)?.toUpperCase() } : {}),
      ...(optional(f.gstin) ? { gstin: optional(f.gstin)?.toUpperCase() } : {}),
      ...(optional(f.cin) ? { cin: optional(f.cin) } : {}),
      ...(optional(f.fssaiLicense) ? { fssaiLicense: optional(f.fssaiLicense) } : {}),
      ...(optional(f.websiteUrl) ? { websiteUrl: optional(f.websiteUrl) } : {}),
      ...(optional(f.businessEmail) ? { businessEmail: optional(f.businessEmail) } : {}),
      ...(optional(f.businessPhone) ? { businessPhone: optional(f.businessPhone) } : {}),
      address: address(f, "business"),
    },
    outlet: {
      name: f.outletName.trim(), ...(optional(f.outletCode) ? { code: optional(f.outletCode) } : {}),
      ...(optional(f.outletPhone) ? { phone: optional(f.outletPhone) } : {}),
      ...(optional(f.outletEmail) ? { email: optional(f.outletEmail) } : {}),
      address: address(f, "outlet"),
      ...(optional(f.outletGstin) ? { gstin: optional(f.outletGstin)?.toUpperCase() } : {}),
      ...(optional(f.outletFssaiLicense) ? { fssaiLicense: optional(f.outletFssaiLicense) } : {}),
      timezone: "Asia/Kolkata",
    },
    acceptedTerms: true,
    termsVersion: "2026-11",
  };
}

export function newRegistrationKey(): string {
  return `fdreg_${crypto.randomUUID()}`;
}
