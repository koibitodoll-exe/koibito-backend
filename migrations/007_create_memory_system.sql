CREATE TABLE IF NOT EXISTS koibito_memories (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL,
    koibito_id INTEGER NOT NULL,

    memory_text TEXT NOT NULL,

    memory_type TEXT DEFAULT 'short_term',
    source TEXT DEFAULT 'chat',

    confidence INTEGER DEFAULT 0,

    mention_count INTEGER DEFAULT 1,

    first_seen TIMESTAMP DEFAULT NOW(),
    last_seen TIMESTAMP DEFAULT NOW(),

    expires_at TIMESTAMP,

    is_core BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_user
ON koibito_memories(user_id);

CREATE INDEX IF NOT EXISTS idx_memory_koibito
ON koibito_memories(koibito_id);

CREATE INDEX IF NOT EXISTS idx_memory_type
ON koibito_memories(memory_type);