export type ProfileFields = {
  tradeName: string;
  registeredBusinessName: string;
  businessType: string;
  industry: string;
  cin: string;
  fssaiLicense: string;
  websiteUrl: string;
  businessEmail: string;
  businessPhone: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  city: string;
  district: string;
  state: string;
  stateCode: string;
  postalCode: string;
  countryCode: string;
  pan: string;
  gstin: string;
};

function optionalText(value: string): string | null {
  return value.trim() || null;
}

function explicitTaxId(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  // Account summaries intentionally mask tax IDs. A masked display value is never a replacement.
  return normalized && !normalized.includes("*") ? normalized : undefined;
}

export function buildBusinessProfilePayload(profile: ProfileFields) {
  const pan = explicitTaxId(profile.pan);
  const gstin = explicitTaxId(profile.gstin);
  return {
    tradeName: profile.tradeName.trim(),
    registeredBusinessName: optionalText(profile.registeredBusinessName),
    businessType: profile.businessType,
    industry: profile.industry.trim(),
    cin: optionalText(profile.cin),
    fssaiLicense: optionalText(profile.fssaiLicense),
    websiteUrl: optionalText(profile.websiteUrl),
    businessEmail: optionalText(profile.businessEmail),
    businessPhone: optionalText(profile.businessPhone),
    address: {
      addressLine1: profile.addressLine1.trim(),
      addressLine2: optionalText(profile.addressLine2) ?? undefined,
      locality: optionalText(profile.locality) ?? undefined,
      city: profile.city.trim(),
      district: optionalText(profile.district) ?? undefined,
      state: profile.state.trim(),
      stateCode: optionalText(profile.stateCode) ?? undefined,
      postalCode: profile.postalCode.trim(),
      countryCode: profile.countryCode,
    },
    ...(pan ? { pan } : {}),
    ...(gstin ? { gstin } : {}),
  };
}
