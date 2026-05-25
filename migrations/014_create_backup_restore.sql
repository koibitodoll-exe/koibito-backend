CREATE TABLE IF NOT EXISTS backup_settings (
  id SERIAL PRIMARY KEY,

  user_id INTEGER UNIQUE NOT NULL
  REFERENCES users(id)
  ON DELETE CASCADE,

  settings_json JSONB
  NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_settings_user_id
ON backup_settings(user_id);


CREATE TABLE IF NOT EXISTS koibito_backups (
  id SERIAL PRIMARY KEY,

  user_id INTEGER NOT NULL
  REFERENCES users(id)
  ON DELETE CASCADE,

  koibito_id INTEGER NOT NULL
  REFERENCES koibitos(id)
  ON DELETE CASCADE,

  backup_json JSONB
  NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP DEFAULT NOW(),
  restored_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_koibito_backups_user_id
ON koibito_backups(user_id);

CREATE INDEX IF NOT EXISTS idx_koibito_backups_koibito_id
ON koibito_backups(koibito_id);

CREATE INDEX IF NOT EXISTS idx_koibito_backups_latest
ON koibito_backups(user_id, koibito_id, created_at DESC);