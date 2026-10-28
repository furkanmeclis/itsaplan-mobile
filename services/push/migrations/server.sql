CREATE TABLE IF NOT EXISTS mobile_preferences (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  events text[] NOT NULL DEFAULT ARRAY['assigned','mentioned','commented','state_changed']::text[],
  CHECK (events <@ ARRAY['assigned','mentioned','commented','state_changed']::text[])
);
CREATE TABLE IF NOT EXISTS mobile_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  gateway_account_id uuid,
  provider text NOT NULL CHECK (provider IN ('apns','fcm')),
  token_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, installation_id)
);
CREATE TABLE IF NOT EXISTS mobile_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id integer NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES mobile_device(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','cancelled','failed','retired')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id, device_id)
);
CREATE INDEX IF NOT EXISTS mobile_delivery_due ON mobile_delivery(next_attempt_at) WHERE status='pending';
CREATE OR REPLACE FUNCTION mobile_enqueue_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.issue_id IS NOT NULL THEN
    INSERT INTO mobile_delivery(notification_id, device_id)
    SELECT NEW.id, d.id FROM mobile_device d
    JOIN mobile_preferences p ON p.user_id=d.user_id
    JOIN "user" u ON u.id=d.user_id
    WHERE d.user_id=NEW.user_id AND d.active AND p.enabled
      AND NEW.type=ANY(p.events) AND u.active IS DISTINCT FROM false
      AND EXISTS(SELECT 1 FROM project_member m WHERE m.project_id=NEW.project_id AND m.user_id=NEW.user_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mobile_notification_outbox ON notification;
CREATE TRIGGER mobile_notification_outbox AFTER INSERT ON notification FOR EACH ROW EXECUTE FUNCTION mobile_enqueue_notification();
