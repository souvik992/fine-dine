// The licence-signing PUBLIC keys the app trusts (Ed25519, SPKI DER, base64). Only the public halves ship with the app.
// master: the vendor's offline key (keygen folder outside this repo, docs/07 "Licence"; `node keygen.mjs public`).
// cloud (P7-02, ADR-0006): DinePOS Cloud's own key, for trials and paid renewals it signs by itself; trusted only for
// keys of at most CLOUD_KEY_MAX_DAYS. Its private half is on the cloud server (HUB_LICENCE_SIGNING_KEY_FILE) with a copy
// in the keygen folder (keys/dinepos-cloud-signing-private.pem). If it ever leaks: ship a build with a new one here.
export const LICENCE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAopGT8UHDwerHs5P/WX78hWGdke5+r9pA/d4Qg611Ujc=';
export const CLOUD_LICENCE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAavKaSo70TYmFgYVeHHaqrNsT9+Jqd0cCyxGQv/2V/38=';
export const CLOUD_KEY_MAX_DAYS = 400;

export const TRUSTED_LICENCE_KEYS = [
  { id: 'master', publicKey: LICENCE_PUBLIC_KEY },
  { id: 'cloud', publicKey: CLOUD_LICENCE_PUBLIC_KEY, maxDays: CLOUD_KEY_MAX_DAYS },
] as const;
