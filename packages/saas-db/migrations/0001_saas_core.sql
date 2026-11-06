-- Fine Dine SaaS PostgreSQL schema, migration 0001.
-- Dedicated SaaS database only. NEVER run through the outlet SQLite migration runner.
-- Money is integer minor units (paise). All timestamps are UTC timestamptz.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 160),
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(trim(email))) STORED,
  phone text,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'blocked', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized_uq UNIQUE (email_normalized)
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  slug text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_type text NOT NULL DEFAULT 'restaurant',
  billing_email text,
  billing_phone text,
  gstin text,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'billing')),
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members(user_id);

CREATE TABLE outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  slug text NOT NULL UNIQUE,
  deployment_type text NOT NULL CHECK (deployment_type IN ('on_premise', 'hosted')),
  hub_store_id text,
  hosted_instance_id text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'closed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_store_id)
);
CREATE INDEX outlets_organization_idx ON outlets(organization_id, status);

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  billing_interval text NOT NULL CHECK (billing_interval IN ('monthly', 'yearly')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  feature_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  quantity integer CHECK (quantity IS NULL OR quantity >= 0),
  UNIQUE (plan_id, feature_code)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id uuid REFERENCES plans(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN (
    'provisioning', 'trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'
  )),
  trial_start_at timestamptz,
  trial_end_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  gateway text,
  gateway_customer_id text,
  gateway_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_end_at IS NULL OR trial_start_at IS NULL OR trial_end_at > trial_start_at),
  CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start)
);
CREATE INDEX subscriptions_org_status_idx ON subscriptions(organization_id, status);
CREATE UNIQUE INDEX subscriptions_one_live_trial_per_org
  ON subscriptions(organization_id)
  WHERE status IN ('provisioning', 'trialing');

CREATE TABLE provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  job_type text NOT NULL DEFAULT 'windows_trial',
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'retry_wait', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  worker_id text,
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provisioning_jobs_claim_idx
  ON provisioning_jobs(status, next_attempt_at)
  WHERE status IN ('queued', 'retry_wait');
CREATE INDEX provisioning_jobs_org_idx ON provisioning_jobs(organization_id, created_at DESC);

CREATE TABLE activation_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activation_challenges_outlet_idx
  ON activation_challenges(outlet_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE RESTRICT,
  licence_type text NOT NULL CHECK (licence_type IN ('trial', 'subscription', 'enterprise')),
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  hardware_id text NOT NULL,
  signed_key_hash text NOT NULL,
  key_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired', 'superseded')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > issued_at)
);
CREATE INDEX licences_outlet_status_idx ON licences(outlet_id, status, expires_at);
CREATE INDEX licences_org_idx ON licences(organization_id, created_at DESC);

CREATE TABLE device_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES outlets(id) ON DELETE RESTRICT,
  licence_id uuid REFERENCES licences(id) ON DELETE RESTRICT,
  device_id text NOT NULL,
  device_type text NOT NULL CHECK (device_type IN ('master', 'terminal', 'captain', 'kds')),
  device_name text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outlet_id, device_id)
);
CREATE INDEX device_activations_active_idx
  ON device_activations(outlet_id, device_type)
  WHERE deactivated_at IS NULL;

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE RESTRICT,
  gateway text NOT NULL,
  gateway_order_id text,
  gateway_payment_id text UNIQUE,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  status text NOT NULL CHECK (status IN (
    'created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded'
  )),
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  gateway_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_org_created_idx ON payments(organization_id, created_at DESC);
CREATE UNIQUE INDEX payments_gateway_order_uq
  ON payments(gateway, gateway_order_id) WHERE gateway_order_id IS NOT NULL;

CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway text NOT NULL,
  gateway_event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed')),
  processed_at timestamptz,
  processing_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, gateway_event_id)
);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  billing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_object_key text,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'void')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_minor = subtotal_minor + tax_minor)
);
CREATE INDEX invoices_org_issued_idx ON invoices(organization_id, issued_at DESC);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'admin', 'system', 'worker')),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id, created_at DESC);

-- Deliberately no sample prices: product owner must approve plan catalogue before launch.
