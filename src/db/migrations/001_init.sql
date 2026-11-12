CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE merchants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  city            text NOT NULL,
  pix_key         text NOT NULL,
  pix_key_type    text NOT NULL CHECK (pix_key_type IN ('cpf', 'cnpj', 'phone', 'email', 'evp')),
  api_key_hash    text NOT NULL UNIQUE,
  webhook_url     text,
  webhook_secret  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE charge_status AS ENUM ('pending', 'paid', 'canceled', 'expired');

CREATE TABLE charges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id    uuid NOT NULL REFERENCES merchants (id),
  txid           text NOT NULL UNIQUE CHECK (txid ~ '^[A-Za-z0-9]{1,25}$'),
  amount_cents   integer NOT NULL CHECK (amount_cents > 0),
  description    text,
  status         charge_status NOT NULL DEFAULT 'pending',
  pix_copy_paste text NOT NULL,
  expires_at     timestamptz NOT NULL,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX charges_merchant_created_idx ON charges (merchant_id, created_at DESC);
-- Partial index: the expiration job only ever looks at pending charges.
CREATE INDEX charges_pending_expiry_idx ON charges (expires_at) WHERE status = 'pending';

CREATE TABLE idempotency_keys (
  merchant_id     uuid NOT NULL REFERENCES merchants (id),
  key             text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, key)
);

-- Inbound PSP notifications already processed (deduplication).
CREATE TABLE psp_events (
  event_id     text PRIMARY KEY,
  txid         text NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Transactional outbox for webhooks sent to merchants.
CREATE TABLE webhook_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id      uuid NOT NULL REFERENCES merchants (id),
  type             text NOT NULL,
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz
);

CREATE INDEX webhook_events_due_idx ON webhook_events (next_attempt_at) WHERE status = 'pending';
