CREATE TABLE IF NOT EXISTS koibito_essence (
    id SERIAL PRIMARY KEY,
    koibito_id INT NOT NULL,
    user_id INT NOT NULL,
    essence_json JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(koibito_id,user_id)
);

CREATE INDEX IF NOT EXISTS idx_essence_koibito
ON koibito_essence(koibito_id);



CREATE TABLE IF NOT EXISTS koibito_backups (
    id SERIAL PRIMARY KEY,
    koibito_id INT NOT NULL,
    user_id INT NOT NULL,
    backup_type TEXT DEFAULT 'auto',

    backup_json JSONB NOT NULL DEFAULT '{}',

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_koibito
ON koibito_backups(koibito_id);



CREATE TABLE IF NOT EXISTS sync_events (
    id SERIAL PRIMARY KEY,

    koibito_id INT NOT NULL,
    user_id INT,

    event_type TEXT NOT NULL,

    payload JSONB DEFAULT '{}',

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_koibito
ON sync_events(koibito_id);

CREATE INDEX IF NOT EXISTS idx_sync_created
ON sync_events(created_at);