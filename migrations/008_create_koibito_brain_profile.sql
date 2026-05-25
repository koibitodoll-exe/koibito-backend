CREATE TABLE IF NOT EXISTS koibito_brain_profile (
    id SERIAL PRIMARY KEY,

    koibito_id INTEGER UNIQUE NOT NULL,

    personality TEXT DEFAULT '',
    traits JSONB DEFAULT '[]',

    must_rules JSONB DEFAULT '[]',
    never_rules JSONB DEFAULT '[]',

    reply_style TEXT DEFAULT '',

    aliases JSONB DEFAULT '[]',

    voice_profile TEXT DEFAULT '',

    mood_behavior JSONB DEFAULT '{}',
    eq_behavior JSONB DEFAULT '{}',

    diary_style TEXT DEFAULT '',

    quirks JSONB DEFAULT '[]',

    system_prompt TEXT DEFAULT '',

    updated_at TIMESTAMP DEFAULT NOW()
);