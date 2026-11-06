-- Fine Dine SaaS migration 0002: browser identity, business profile and outlet contact data.
-- PostgreSQL SaaS database only. Never run through the outlet SQLite migration runner.
-- Token values are never stored; only SHA-256 digests are persisted.

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  user_agent text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
  ON user_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS user_auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS user_auth_tokens_pending_idx
  ON user_auth_tokens(user_id, purpose, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS organization_business_profiles (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  registered_business_name text,
  trade_name text NOT NULL CHECK (length(trim(trade_name)) BETWEEN 1 AND 180),
  business_type text NOT NULL DEFAULT 'restaurant',
  industry text NOT NULL DEFAULT 'food_service',
  pan text,
  gstin text,
  cin text,
  fssai_license text,
  website_url text,
  business_email text,
  business_phone text,
  address_line1 text,
  address_line2 text,
  locality text,
  city text,
  district text,
  state text,
  state_code text,
  postal_code text,
  country_code char(2) NOT NULL DEFAULT 'IN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CHECK (state_code IS NULL OR length(state_code) BETWEEN 1 AND 3),
  CHECK (postal_code IS NULL OR length(trim(postal_code)) BETWEEN 3 AND 12),
  CHECK (country_code ~ '^[A-Z]{2}$')
);

ALTER TABLE outlets
  ADD COLUMN IF NOT EXISTS outlet_code text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS locality text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS state_code text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country_code char(2) NOT NULL DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS fssai_license text;

CREATE UNIQUE INDEX IF NOT EXISTS outlets_org_code_uq
  ON outlets(organization_id, outlet_code)
  WHERE outlet_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  response_status integer,
  response_body jsonb,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key),
  CHECK ((completed_at IS NULL) = (response_status IS NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idempotency_records_expiry_idx
  ON idempotency_records(expires_at);
