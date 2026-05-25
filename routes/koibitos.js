const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { generateKOI } = require("../utils/idGenerator");
const { syncSoulPacket } = require("../services/soulPacketSync");

async function ensureKoibitoOwnership(koibitoId, userId) {
  const result = await pool.query(
    `SELECT id, user_id FROM koibitos WHERE id = $1 AND user_id = $2`,
    [koibitoId, userId]
  );
  return result.rows[0] || null;
}

// GET /koibitos
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT 
         k.id,
         k.user_id,
         k.name,
         k.avatar,
         k.gender,
         k.koibito_code,
         COALESCE(k.is_primary, false) AS is_primary,
         COALESCE(d.online_status, k.status, 'offline') AS status,
         COALESCE(k.battery_percent, 0) AS battery_percent,
         k.paired_at,
         k.created_at,
         k.updated_at
       FROM koibitos k
       LEFT JOIN devices d ON d.koibito_id = k.id
       WHERE k.user_id = $1
       ORDER BY COALESCE(k.is_primary, false) DESC, k.id ASC`,
      [userId]
    );

    res.json({
      success: true,
      koibitos: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibitos" });
  }
});

// GET /koibitos/:id/profile
router.get("/:id/profile", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoResult = await pool.query(
      `SELECT
         k.id,
         k.user_id,
         k.name,
         k.avatar,
         k.gender,
         k.koibito_code,
         COALESCE(k.is_primary, false) AS is_primary,
         COALESCE(d.online_status, k.status, 'offline') AS status,
         COALESCE(k.battery_percent, 0) AS battery_percent,
         k.paired_at
       FROM koibitos k
       LEFT JOIN devices d ON d.koibito_id = k.id
       WHERE k.id = $1 AND k.user_id = $2`,
      [koibitoId, userId]
    );

    if (koibitoResult.rows.length === 0) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const traitsResult = await pool.query(
      `SELECT td.id, td.trait_key, td.label, td.category
       FROM koibito_traits kt
       JOIN trait_definitions td ON td.id = kt.trait_id
       WHERE kt.koibito_id = $1
       ORDER BY td.label ASC`,
      [koibitoId]
    );

    const badgesResult = await pool.query(
      `SELECT 
         bd.id,
         bd.badge_key,
         bd.label,
         bd.category,
         bd.description,
         bd.icon,
         bd.color_start,
         bd.color_end,
         kb.unlocked_at
       FROM koibito_badges kb
       JOIN badge_definitions bd ON bd.id = kb.badge_id
       WHERE kb.koibito_id = $1
       ORDER BY kb.unlocked_at DESC`,
      [koibitoId]
    );

    res.json({
      success: true,
      koibito: koibitoResult.rows[0],
      personality_traits: traitsResult.rows,
      badges: badgesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibito profile" });
  }
});

// GET /koibitos/:id/rules
router.get("/:id/rules", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `SELECT koibito_id, must_rules, never_rules, character_rule, created_at, updated_at
       FROM koibito_rules
       WHERE koibito_id = $1`,
      [koibitoId]
    );

    res.json({
      success: true,
      rules: result.rows[0] || {
        koibito_id: Number(koibitoId),
        must_rules: [],
        never_rules: [],
        character_rule: "",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch rules" });
  }
});

// GET /koibitos/:id/character-rule
router.get("/:id/character-rule", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `SELECT character_rule
       FROM koibito_rules
       WHERE koibito_id = $1`,
      [koibitoId]
    );

    res.json({
      success: true,
      character_rule: result.rows[0]?.character_rule || "",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch character rule" });
  }
});

// GET /koibitos/:id/aliases
router.get("/:id/aliases", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `SELECT koibito_id, aliases, created_at, updated_at
       FROM koibito_aliases
       WHERE koibito_id = $1`,
      [koibitoId]
    );

    res.json({
      success: true,
      aliases: result.rows[0] || {
        koibito_id: Number(koibitoId),
        aliases: [],
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch aliases" });
  }
});

// GET /koibitos/:id/badges
router.get("/:id/badges", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `SELECT 
         bd.id,
         bd.badge_key,
         bd.label,
         bd.category,
         bd.description,
         bd.icon,
         bd.color_start,
         bd.color_end,
         kb.unlocked_at
       FROM koibito_badges kb
       JOIN badge_definitions bd ON bd.id = kb.badge_id
       WHERE kb.koibito_id = $1
       ORDER BY kb.unlocked_at DESC`,
      [koibitoId]
    );

    res.json({
      success: true,
      badges: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch badges" });
  }
});

// GET /koibitos/:id
router.get("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT 
         k.id,
         k.user_id,
         k.name,
         k.avatar,
         k.gender,
         k.koibito_code,
         COALESCE(k.is_primary, false) AS is_primary,
         COALESCE(d.online_status, k.status, 'offline') AS status,
         COALESCE(k.battery_percent, 0) AS battery_percent,
         k.paired_at,
         k.created_at,
         k.updated_at
       FROM koibitos k
       LEFT JOIN devices d ON d.koibito_id = k.id
       WHERE k.id = $1 AND k.user_id = $2`,
      [koibitoId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    res.json({
      success: true,
      koibito: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch Koibito" });
  }
});

// POST /koibitos/pair
router.post("/pair", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    name,
    avatar,
    gender = null,
    device_id,
    is_primary = false,
  } = req.body;

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (is_primary) {
      await client.query(
        `UPDATE koibitos
         SET is_primary = false, updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    }

    let koibitoCode = await generateKOI();

    if (device_id) {
      const existingDevice = await client.query(
        `SELECT k.koibito_code
         FROM devices d
         JOIN koibitos k ON k.id = d.koibito_id
         WHERE d.device_id = $1
         LIMIT 1`,
        [device_id]
      );

      if (existingDevice.rows.length > 0) {
        koibitoCode = existingDevice.rows[0].koibito_code;
      }
    }

    const koibitoResult = await client.query(
      `INSERT INTO koibitos (
         user_id,
         name,
         avatar,
         gender,
         is_primary,
         koibito_code,
         entity_type,
         paired_at,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'koibito', NOW(), NOW(), NOW())
       RETURNING *`,
      [userId, name, avatar || null, gender, Boolean(is_primary), koibitoCode]
    );

    const koibito = koibitoResult.rows[0];

    if (device_id) {
      await client.query(
        `UPDATE devices
         SET koibito_id = $1
         WHERE device_id = $2`,
        [koibito.id, device_id]
      );
    }

    await client.query("COMMIT");

    await syncSoulPacket(koibito.id, userId);

    res.json({
      success: true,
      message: "Koibito paired and Soul Packet synced",
      koibito,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to pair Koibito" });
  } finally {
    client.release();
  }
});

// PATCH /koibitos/:id
router.patch("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const {
    name,
    avatar,
    gender,
    status,
    battery_percent,
    is_primary,
  } = req.body;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM koibitos WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Koibito not found" });
    }

    if (is_primary === true) {
      await client.query(
        `UPDATE koibitos
         SET is_primary = false, updated_at = NOW()
         WHERE user_id = $1 AND id <> $2`,
        [userId, koibitoId]
      );
    }

    const result = await client.query(
      `UPDATE koibitos
       SET name = COALESCE($1, name),
           avatar = COALESCE($2, avatar),
           gender = COALESCE($3, gender),
           status = COALESCE($4, status),
           battery_percent = COALESCE($5, battery_percent),
           is_primary = COALESCE($6, is_primary),
           updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [name, avatar, gender, status, battery_percent, is_primary, koibitoId, userId]
    );

    await client.query("COMMIT");

    await syncSoulPacket(koibitoId, userId);

    res.json({
      success: true,
      message: "Koibito updated and Soul Packet synced",
      koibito: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to update Koibito" });
  } finally {
    client.release();
  }
});

// PATCH /koibitos/:id/primary
router.patch("/:id/primary", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const koibitoCheck = await client.query(
      `SELECT id FROM koibitos WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    if (koibitoCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Koibito not found" });
    }

    await client.query(
      `UPDATE koibitos
       SET is_primary = false, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    const result = await client.query(
      `UPDATE koibitos
       SET is_primary = true, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [koibitoId, userId]
    );

    await client.query("COMMIT");

    await syncSoulPacket(koibitoId, userId);

    res.json({
      success: true,
      message: "Primary Koibito updated and Soul Packet synced and Soul Packet synced",
      koibito: result.rows[0],
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to update primary Koibito" });
  } finally {
    client.release();
  }
});

// DELETE /koibitos/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const koibitoCheck = await client.query(
      `SELECT id FROM koibitos WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    if (koibitoCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Koibito not found" });
    }

    await client.query(
      `UPDATE devices
       SET koibito_id = NULL
       WHERE koibito_id = $1`,
      [koibitoId]
    );

    await client.query(
      `DELETE FROM koibitos
       WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Koibito unpaired successfully",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to unpair Koibito" });
  } finally {
    client.release();
  }
});

// PUT /koibitos/:id/rules
router.put("/:id/rules", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { must_rules = [], never_rules = [], character_rule = "" } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    await pool.query(
      `INSERT INTO koibito_rules (koibito_id, must_rules, never_rules, character_rule, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         must_rules = EXCLUDED.must_rules,
         never_rules = EXCLUDED.never_rules,
         character_rule = EXCLUDED.character_rule,
         updated_at = NOW()`,
      [koibitoId, JSON.stringify(must_rules), JSON.stringify(never_rules), character_rule]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({ success: true, message: "Rules updated and Soul Packet synced" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update rules" });
  }
});

// PUT /koibitos/:id/character-rule
router.put("/:id/character-rule", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { character_rule = "" } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    await pool.query(
      `INSERT INTO koibito_rules (koibito_id, character_rule, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         character_rule = EXCLUDED.character_rule,
         updated_at = NOW()`,
      [koibitoId, character_rule]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({
      success: true,
      message: "Character rule updated and Soul Packet synced",
      character_rule,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update character rule" });
  }
});

// PUT /koibitos/:id/aliases
router.put("/:id/aliases", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { aliases = [] } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    await pool.query(
      `INSERT INTO koibito_aliases (koibito_id, aliases, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         aliases = EXCLUDED.aliases,
         updated_at = NOW()`,
      [koibitoId, JSON.stringify(aliases)]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({ success: true, message: "Aliases updated and Soul Packet synced" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update aliases" });
  }
});

// PUT /koibitos/:id/voice
router.put("/:id/voice", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { voice_profile_id } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const voiceCheck = await pool.query(
      `SELECT id, voice_key, label, provider
       FROM voice_profiles
       WHERE id = $1`,
      [voice_profile_id]
    );

    if (voiceCheck.rows.length === 0) {
      return res.status(404).json({ message: "Voice profile not found" });
    }

    await pool.query(
      `INSERT INTO koibito_voice_settings (koibito_id, voice_profile_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         voice_profile_id = EXCLUDED.voice_profile_id,
         updated_at = NOW()`,
      [koibitoId, voice_profile_id]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({ success: true, message: "Voice updated and Soul Packet synced" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update voice" });
  }
});

// POST /koibitos/:id/badges
router.post("/:id/badges", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { badge_id } = req.body;

  if (!badge_id) {
    return res.status(400).json({ message: "badge_id is required" });
  }

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const badgeCheck = await pool.query(
      `SELECT id FROM badge_definitions WHERE id = $1`,
      [badge_id]
    );

    if (badgeCheck.rows.length === 0) {
      return res.status(404).json({ message: "Badge not found" });
    }

    await pool.query(
      `INSERT INTO koibito_badges (koibito_id, badge_id)
       VALUES ($1, $2)
       ON CONFLICT (koibito_id, badge_id) DO NOTHING`,
      [koibitoId, badge_id]
    );

    const result = await pool.query(
      `SELECT 
         bd.id,
         bd.badge_key,
         bd.label,
         bd.category,
         bd.description,
         bd.icon,
         bd.color_start,
         bd.color_end,
         kb.unlocked_at
       FROM koibito_badges kb
       JOIN badge_definitions bd ON bd.id = kb.badge_id
       WHERE kb.koibito_id = $1
       ORDER BY kb.unlocked_at DESC`,
      [koibitoId]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({
      success: true,
      message: "Badge assigned and Soul Packet synced",
      badges: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to assign badge" });
  }
});

// GET /koibitos/:id/settings
router.get("/:id/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const featuresResult = await pool.query(
      `SELECT * FROM koibito_settings WHERE koibito_id = $1`,
      [koibitoId]
    );

    const audioResult = await pool.query(
      `SELECT * FROM koibito_audio_settings WHERE koibito_id = $1`,
      [koibitoId]
    );

    const healthResult = await pool.query(
      `SELECT * FROM device_health_settings WHERE koibito_id = $1`,
      [koibitoId]
    );

    const modelResult = await pool.query(
      `SELECT * FROM ai_model_settings WHERE koibito_id = $1`,
      [koibitoId]
    );

    res.json({
      success: true,
      features: featuresResult.rows[0] || null,
      audio: audioResult.rows[0] || null,
      health: healthResult.rows[0] || null,
      model: modelResult.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibito settings" });
  }
});

// PUT /koibitos/:id/settings/features
router.put("/:id/settings/features", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const {
    eq_system = true,
    daily_mood = true,
    mood_sync = true,
    jealousy = true,
    passive_listening = false,
    diary_mode = true,
    profanity_mode = false,
    reminder_mode = true,
    moments_mode = true,
    wake_word = true,
    idle_after_minutes = 60,
    sleep_after_minutes = 120,
    safe_mode = false,
    dev_mode = false,
  } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `INSERT INTO koibito_settings
       (koibito_id, eq_system, daily_mood, mood_sync, jealousy, passive_listening, diary_mode, profanity_mode, reminder_mode, moments_mode, wake_word, idle_after_minutes, sleep_after_minutes, safe_mode, dev_mode, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         eq_system = EXCLUDED.eq_system,
         daily_mood = EXCLUDED.daily_mood,
         mood_sync = EXCLUDED.mood_sync,
         jealousy = EXCLUDED.jealousy,
         passive_listening = EXCLUDED.passive_listening,
         diary_mode = EXCLUDED.diary_mode,
         profanity_mode = EXCLUDED.profanity_mode,
         reminder_mode = EXCLUDED.reminder_mode,
         moments_mode = EXCLUDED.moments_mode,
         wake_word = EXCLUDED.wake_word,
         idle_after_minutes = EXCLUDED.idle_after_minutes,
         sleep_after_minutes = EXCLUDED.sleep_after_minutes,
         safe_mode = EXCLUDED.safe_mode,
         dev_mode = EXCLUDED.dev_mode,
         updated_at = NOW()
       RETURNING *`,
      [
        koibitoId, eq_system, daily_mood, mood_sync, jealousy, passive_listening,
        diary_mode, profanity_mode, reminder_mode, moments_mode, wake_word,
        idle_after_minutes, sleep_after_minutes, safe_mode, dev_mode
      ]
    );

    await syncSoulPacket(koibitoId, userId);

    res.json({
      success: true,
      message: "Koibito feature settings updated and Soul Packet synced",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update feature settings" });
  }
});

// PUT /koibitos/:id/settings/audio
router.put("/:id/settings/audio", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const {
    cloud_tts = true,
    earbud_mode = false,
    volume = 70,
  } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `INSERT INTO koibito_audio_settings
       (koibito_id, cloud_tts, earbud_mode, volume, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         cloud_tts = EXCLUDED.cloud_tts,
         earbud_mode = EXCLUDED.earbud_mode,
         volume = EXCLUDED.volume,
         updated_at = NOW()
       RETURNING *`,
      [koibitoId, cloud_tts, earbud_mode, volume]
    );

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       SELECT d.device_id, 'config_patch', $2
       FROM devices d
       WHERE d.koibito_id = $1`,
      [koibitoId, JSON.stringify(result.rows[0])]
    );

    res.json({
      success: true,
      message: "Audio settings updated and sync queued",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update audio settings" });
  }
});

// PUT /koibitos/:id/settings/health
router.put("/:id/settings/health", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const {
    diagnostic_interval_weeks = 2,
    self_diagnose_interval_weeks = 2,
    health_report_interval_months = 6,
    report_only_if_issue = true,
    keep_logs_local = true,
  } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `INSERT INTO device_health_settings
       (koibito_id, diagnostic_interval_weeks, self_diagnose_interval_weeks, health_report_interval_months, report_only_if_issue, keep_logs_local, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         diagnostic_interval_weeks = EXCLUDED.diagnostic_interval_weeks,
         self_diagnose_interval_weeks = EXCLUDED.self_diagnose_interval_weeks,
         health_report_interval_months = EXCLUDED.health_report_interval_months,
         report_only_if_issue = EXCLUDED.report_only_if_issue,
         keep_logs_local = EXCLUDED.keep_logs_local,
         updated_at = NOW()
       RETURNING *`,
      [koibitoId, diagnostic_interval_weeks, self_diagnose_interval_weeks, health_report_interval_months, report_only_if_issue, keep_logs_local]
    );

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       SELECT d.device_id, 'config_patch', $2
       FROM devices d
       WHERE d.koibito_id = $1`,
      [koibitoId, JSON.stringify(result.rows[0])]
    );

    res.json({
      success: true,
      message: "Health settings updated and sync queued",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update health settings" });
  }
});

// PUT /koibitos/:id/settings/model
router.put("/:id/settings/model", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { selected_model = "gpt-5.4-mini" } = req.body;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    const result = await pool.query(
      `INSERT INTO ai_model_settings
       (koibito_id, selected_model, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (koibito_id)
       DO UPDATE SET
         selected_model = EXCLUDED.selected_model,
         updated_at = NOW()
       RETURNING *`,
      [koibitoId, selected_model]
    );

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       SELECT d.device_id, 'config_patch', $2
       FROM devices d
       WHERE d.koibito_id = $1`,
      [koibitoId, JSON.stringify(result.rows[0])]
    );

    res.json({
      success: true,
      message: "AI model updated and sync queued",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update AI model settings" });
  }
});

// POST /koibitos/:id/settings/soft-reset
router.post("/:id/settings/soft-reset", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       SELECT d.device_id, 'soft_reset', $2
       FROM devices d
       WHERE d.koibito_id = $1`,
      [koibitoId, JSON.stringify({ koibito_id: koibitoId, preserve_memories: true })]
    );

    res.json({
      success: true,
      message: "Soft reset queued",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to queue soft reset" });
  }
});

// POST /koibitos/:id/settings/hard-reset
router.post("/:id/settings/hard-reset", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;

  try {
    const koibitoCheck = await ensureKoibitoOwnership(koibitoId, userId);

    if (!koibitoCheck) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       SELECT d.device_id, 'factory_reset', $2
       FROM devices d
       WHERE d.koibito_id = $1`,
      [koibitoId, JSON.stringify({ koibito_id: koibitoId, preserve_identity: true })]
    );

    res.json({
      success: true,
      message: "Hard reset queued",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to queue hard reset" });
  }
});

module.exports = router; 
