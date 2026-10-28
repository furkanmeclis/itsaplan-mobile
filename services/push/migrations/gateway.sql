CREATE TABLE IF NOT EXISTS push_tenant (
  id uuid PRIMARY KEY,
  key_hash text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS push_device (
  tenant_id uuid NOT NULL REFERENCES push_tenant(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  route_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK(provider IN ('apns','fcm')),
  token_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  events text[] NOT NULL,
  retired boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS push_delivery (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  device_id uuid NOT NULL,
  notification_id uuid NOT NULL,
  event text NOT NULL CHECK(event IN ('assigned','mentioned','commented','state_changed')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','cancelled','failed','retired')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,device_id) REFERENCES push_device(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS push_delivery_due ON push_delivery(next_attempt_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS push_rate (
  tenant_id uuid NOT NULL REFERENCES push_tenant(id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY(tenant_id,bucket)
);
