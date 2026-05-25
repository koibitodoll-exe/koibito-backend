CREATE TABLE IF NOT EXISTS sync_events (
    id SERIAL PRIMARY KEY,

    koibito_id INTEGER NOT NULL,

    event_type TEXT NOT NULL,

    payload JSONB DEFAULT '{}',

    source TEXT DEFAULT '',

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_sync_state (
    id SERIAL PRIMARY KEY,

    hardware_id TEXT UNIQUE NOT NULL,

    koibito_id INTEGER NOT NULL,

    last_synced_at TIMESTAMP DEFAULT NOW(),

    is_online BOOLEAN DEFAULT FALSE,

    updated_at TIMESTAMP DEFAULT NOW()
);