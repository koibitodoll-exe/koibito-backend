const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

function normalizeTraitLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function makeTraitKey(label) {
  return normalizeTraitLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

async function ensureUniqueTraitKey(client, baseKey) {
  const safeBase = baseKey || "custom_trait";

  const existing = await client.query(
    `SELECT trait_key FROM trait_definitions WHERE trait_key = $1`,
    [safeBase]
  );

  if (existing.rows.length === 0) return safeBase;

  let counter = 2;
  while (true) {
    const candidate = `${safeBase}_${counter}`;
    const check = await client.query(
      `SELECT trait_key FROM trait_definitions WHERE trait_key = $1`,
      [candidate]
    );

    if (check.rows.length === 0) return candidate;
    counter += 1;
  }
}

async function queueConfigPatchForKoibito(koibitoId) {
  const koibitoResult = await pool.query(
    `SELECT
       k.id,
       k.name,
       k.avatar,
       k.gender,
       COALESCE(k.is_primary, false) AS is_primary
     FROM koibitos k
     WHERE k.id = $1`,
    [koibitoId]
  );

  if (koibitoResult.rows.length === 0) return;

  const koibito = koibitoResult.rows[0];

  const aliasesResult = await pool.query(
    `SELECT aliases
     FROM koibito_aliases
     WHERE koibito_id = $1`,
    [koibitoId]
  );

  const rulesResult = await pool.query(
    `SELECT must_rules, never_rules, character_rule
     FROM koibito_rules
     WHERE koibito_id = $1`,
    [koibitoId]
  );

  const traitsResult = await pool.query(
    `SELECT td.label
     FROM koibito_traits kt
     JOIN trait_definitions td ON td.id = kt.trait_id
     WHERE kt.koibito_id = $1
     ORDER BY td.label ASC`,
    [koibitoId]
  );

  const voiceResult = await pool.query(
    `SELECT
       vp.id,
       vp.voice_key,
       vp.label,
       vp.provider
     FROM koibito_voice_settings kvs
     JOIN voice_profiles vp ON vp.id = kvs.voice_profile_id
     WHERE kvs.koibito_id = $1`,
    [koibitoId]
  );

  const settingsResult = await pool.query(
    `SELECT profanity_mode
     FROM koibito_settings
     WHERE koibito_id = $1`,
    [koibitoId]
  );

  const aliases = aliasesResult.rows[0]?.aliases || [];
  const rules = rulesResult.rows[0] || {
    must_rules: [],
    never_rules: [],
    character_rule: "",
  };
  const traits = traitsResult.rows.map((row) => row.label);
  const voice = voiceResult.rows[0] || null;
  const profanity_mode = settingsResult.rows[0]?.profanity_mode ?? false;

  const payload = {
    koibito_id: koibito.id,
    patch: {
      doll_profile: {
        name: koibito.name,
        avatar: koibito.avatar,
        gender: koibito.gender,
        is_primary: koibito.is_primary,
        aliases,
        traits,
        must_rules: rules.must_rules || [],
        never_rules: rules.never_rules || [],
        character_rule: rules.character_rule || "",
        profanity_allowed: profanity_mode,
        voice: voice
          ? {
              id: voice.id,
              voice_key: voice.voice_key,
              label: voice.label,
              provider: voice.provider,
            }
          : null,
      },
    },
  };

  await pool.query(
    `INSERT INTO device_commands (device_id, command_type, payload)
     SELECT d.device_id, 'config_patch', $2
     FROM devices d
     WHERE d.koibito_id = $1`,
    [koibitoId, JSON.stringify(payload)]
  );
}

// GET /traits
router.get("/traits", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, trait_key, label, category
       FROM trait_definitions
       WHERE is_active = TRUE
       ORDER BY label ASC`
    );

    res.json({
      success: true,
      traits: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch traits" });
  }
});

// PUT /koibitos/:id/traits
router.put("/koibitos/:id/traits", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { trait_ids, traits } = req.body;

  const hasTraitIds = Array.isArray(trait_ids);
  const hasTraitLabels = Array.isArray(traits);

  if (!hasTraitIds && !hasTraitLabels) {
    return res.status(400).json({
      message: "Provide either trait_ids array or traits array",
    });
  }

  const client = await pool.connect();

  try {
    const koibitoCheck = await client.query(
      `SELECT id FROM koibitos WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    if (koibitoCheck.rows.length === 0) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    let finalTraitIds = [];

    await client.query("BEGIN");

    if (hasTraitIds) {
      if (trait_ids.length > 12) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Maximum 12 traits allowed" });
      }

      const normalizedIds = [...new Set(trait_ids.map(Number).filter(Number.isFinite))];

      const validTraits = await client.query(
        `SELECT id
         FROM trait_definitions
         WHERE id = ANY($1::int[]) AND is_active = TRUE`,
        [normalizedIds]
      );

      if (validTraits.rows.length !== normalizedIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "One or more trait_ids are invalid" });
      }

      finalTraitIds = normalizedIds;
    } else {
      const cleanedTraits = [
        ...new Set(traits.map(normalizeTraitLabel).filter(Boolean)),
      ];

      if (cleanedTraits.length > 12) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Maximum 12 traits allowed" });
      }

      for (const label of cleanedTraits) {
        const existing = await client.query(
          `SELECT id
           FROM trait_definitions
           WHERE LOWER(label) = LOWER($1)
           LIMIT 1`,
          [label]
        );

        if (existing.rows.length > 0) {
          finalTraitIds.push(existing.rows[0].id);
          continue;
        }

        const baseKey = makeTraitKey(label);
        const uniqueKey = await ensureUniqueTraitKey(client, baseKey);

        const inserted = await client.query(
          `INSERT INTO trait_definitions (trait_key, label, category, is_active)
           VALUES ($1, $2, $3, TRUE)
           RETURNING id`,
          [uniqueKey, label, "custom"]
        );

        finalTraitIds.push(inserted.rows[0].id);
      }

      finalTraitIds = [...new Set(finalTraitIds.map(Number).filter(Number.isFinite))];
    }

    await client.query(`DELETE FROM koibito_traits WHERE koibito_id = $1`, [koibitoId]);

    for (const traitId of finalTraitIds) {
      await client.query(
        `INSERT INTO koibito_traits (koibito_id, trait_id)
         VALUES ($1, $2)`,
        [koibitoId, traitId]
      );
    }

    const result = await client.query(
      `SELECT td.id, td.trait_key, td.label, td.category
       FROM koibito_traits kt
       JOIN trait_definitions td ON td.id = kt.trait_id
       WHERE kt.koibito_id = $1
       ORDER BY td.label ASC`,
      [koibitoId]
    );

    await client.query("COMMIT");

    await queueConfigPatchForKoibito(koibitoId);

    res.json({
      success: true,
      message: "Traits updated and config patch queued",
      traits: result.rows,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error(err);
    res.status(500).json({ message: "Failed to update traits" });
  } finally {
    client.release();
  }
});

module.exports = router;