const pool = require("../db");

function safeArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [];
}

function safeObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
}

async function buildEssenceFromLiveTables(koibitoId) {
  const profileRes = await pool.query(
    `
    SELECT
      k.id,
      k.name,
      k.avatar,
      k.gender,
      k.koibito_code,
      COALESCE(k.is_primary, false) AS is_primary
    FROM koibitos k
    WHERE k.id = $1
    LIMIT 1
    `,
    [koibitoId]
  );

  const aliasesRes = await pool.query(
    `
    SELECT aliases
    FROM koibito_aliases
    WHERE koibito_id = $1
    LIMIT 1
    `,
    [koibitoId]
  );

  const rulesRes = await pool.query(
    `
    SELECT must_rules, never_rules, character_rule
    FROM koibito_rules
    WHERE koibito_id = $1
    LIMIT 1
    `,
    [koibitoId]
  );

  const traitsRes = await pool.query(
    `
    SELECT
      td.id,
      td.trait_key,
      td.label,
      td.category
    FROM koibito_traits kt
    JOIN trait_definitions td
      ON td.id = kt.trait_id
    WHERE kt.koibito_id = $1
    ORDER BY td.label ASC
    `,
    [koibitoId]
  );

  const voiceRes = await pool.query(
    `
    SELECT
      vp.id,
      vp.voice_key,
      vp.label,
      vp.provider
    FROM koibito_voice_settings kvs
    JOIN voice_profiles vp
      ON vp.id = kvs.voice_profile_id
    WHERE kvs.koibito_id = $1
    LIMIT 1
    `,
    [koibitoId]
  );

  const settingsRes = await pool.query(
    `
    SELECT settings_json
    FROM koibito_settings
    WHERE koibito_id = $1
    LIMIT 1
    `,
    [koibitoId]
  );

  const profile = profileRes.rows[0] || {};
  const aliases = aliasesRes.rows[0]?.aliases || [];
  const rules = rulesRes.rows[0] || {};
  const traits = traitsRes.rows || [];
  const voice = voiceRes.rows[0] || null;
  const settingsJson = settingsRes.rows[0]?.settings_json || {};

  const presetTraits = traits
    .filter((trait) => trait.category !== "custom")
    .map((trait) => ({
      id: trait.id,
      trait_key: trait.trait_key,
      label: trait.label,
      category: trait.category,
    }));

  const customTraits = traits
    .filter((trait) => trait.category === "custom")
    .map((trait) => ({
      id: trait.id,
      trait_key: trait.trait_key,
      label: trait.label,
      category: trait.category,
    }));

  return {
    identity: {
      id: profile.id || koibitoId,
      koibito_code: profile.koibito_code || null,
      name: profile.name || "Unnamed Koibito",
      avatar: profile.avatar || null,
      gender: profile.gender || null,
      is_primary: Boolean(profile.is_primary),
    },

    personality: {
      preset_traits: presetTraits,
      custom_traits: customTraits,
      trait_labels: traits.map((trait) => trait.label).filter(Boolean),
      character_rule: rules.character_rule || "",
      must_rules: safeArray(rules.must_rules),
      never_rules: safeArray(rules.never_rules),
      aliases: safeArray(aliases),
      profanity_allowed: Boolean(
        settingsJson?.features?.profanity_mode ??
          settingsJson?.profanity_mode ??
          false
      ),
    },

    voice: voice
      ? {
          id: voice.id,
          voice_key: voice.voice_key,
          label: voice.label,
          provider: voice.provider,
        }
      : null,

    source: "live_tables",
  };
}

async function buildSoulPacket(koibitoId, userId) {
  const profileRes = await pool.query(
    `
    SELECT *
    FROM koibito_brain_profile
    WHERE koibito_id = $1
    `,
    [koibitoId]
  );

  const memoryRes = await pool.query(
    `
    SELECT *
    FROM koibito_memories
    WHERE koibito_id = $1
      AND user_id = $2
      AND memory_type = 'long_term'
    ORDER BY last_seen DESC
    LIMIT 20
    `,
    [koibitoId, userId]
  );

  const eqRes = await pool.query(
    `
    SELECT *
    FROM user_koibito_eq
    WHERE koibito_id = $1
      AND user_id = $2
    `,
    [koibitoId, userId]
  );

  const badgeRes = await pool.query(
    `
    SELECT badge_id
    FROM koibito_badges
    WHERE koibito_id = $1
      AND user_id = $2
    `,
    [koibitoId, userId]
  );

  const storedEssenceRes = await pool.query(
    `
    SELECT essence_json, updated_at
    FROM koibito_essence
    WHERE koibito_id = $1
      AND user_id = $2
    LIMIT 1
    `,
    [koibitoId, userId]
  );

  const profile = profileRes.rows[0] || {};
  const eq = eqRes.rows[0] || {};

  const liveEssence = await buildEssenceFromLiveTables(koibitoId);

  const storedEssence = storedEssenceRes.rows[0]?.essence_json
    ? safeObject(storedEssenceRes.rows[0].essence_json)
    : null;

  return {
    koibito_id: koibitoId,
    user_id: userId,

    essence: storedEssence || liveEssence,

    essence_meta: {
      source: storedEssence ? "koibito_essence" : "live_tables",
      updated_at: storedEssenceRes.rows[0]?.updated_at || null,
    },

    brain_profile: profile,

    relationship: {
      level: eq.relationship_level || 1,
      label: eq.relationship_label || "Familiar",

      comfort: eq.comfort || 0,
      trust: eq.trust || 0,
      chaos: eq.chaos || 0,
      romance: eq.romance || 0,
      mentorship: eq.mentorship || 0,
      dependency: eq.dependency || 0,
    },

    memories: memoryRes.rows,

    badges: badgeRes.rows,

    packet_meta: {
      version: 1,
      built_at: new Date().toISOString(),
    },
  };
}

module.exports = {
  buildSoulPacket,
  buildEssenceFromLiveTables,
};