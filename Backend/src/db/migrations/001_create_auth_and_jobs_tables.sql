CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email citext NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'employee',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email::text)) > 0),
  CONSTRAINT users_password_hash_not_blank CHECK (length(trim(password_hash)) > 0),
  CONSTRAINT users_role_valid CHECK (role IN ('employee', 'admin'))
);

CREATE TABLE IF NOT EXISTS flipkart_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seller_email text NOT NULL,
  seller_password_encrypted text NOT NULL,
  is_verified boolean NOT NULL DEFAULT false,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT flipkart_accounts_user_id_unique UNIQUE (user_id),
  CONSTRAINT flipkart_accounts_user_id_fk
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE,
  CONSTRAINT flipkart_accounts_seller_email_not_blank CHECK (length(trim(seller_email)) > 0),
  CONSTRAINT flipkart_accounts_password_not_blank CHECK (length(trim(seller_password_encrypted)) > 0),
  CONSTRAINT flipkart_accounts_verified_timestamp_check CHECK (
    (is_verified = false) OR (last_verified_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  csv_path text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  CONSTRAINT jobs_user_id_fk
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE CASCADE,
  CONSTRAINT jobs_csv_path_not_blank CHECK (length(trim(csv_path)) > 0),
  CONSTRAINT jobs_status_valid CHECK (
    status IN ('queued', 'processing', 'done', 'failed', 'cancelled')
  ),
  CONSTRAINT jobs_completed_at_status_check CHECK (
    (status IN ('queued', 'processing') AND completed_at IS NULL)
    OR
    (status IN ('done', 'failed', 'cancelled') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);
CREATE INDEX IF NOT EXISTS flipkart_accounts_user_id_idx ON flipkart_accounts (user_id);
CREATE INDEX IF NOT EXISTS flipkart_accounts_is_verified_idx ON flipkart_accounts (is_verified);
CREATE INDEX IF NOT EXISTS jobs_user_id_created_at_idx ON jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS flipkart_accounts_set_updated_at ON flipkart_accounts;
CREATE TRIGGER flipkart_accounts_set_updated_at
BEFORE UPDATE ON flipkart_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
