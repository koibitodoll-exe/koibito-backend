const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

const DEFAULT_KOIBITO_SETTINGS = {
  features: {
    eq_enabled: true,
    daily_mood_enabled: true,
    mood_sync_enabled: true,
    jealousy_enabled: false,
    passive_listening_enabled: true,
  },
  voice_audio: {
    cloud_tts_enabled: true,
    earbud_mode_enabled: false,
    volume: 75,
  },
  interactions: {
    diary_mode_enabled: true,
    profanity_enabled: true,
    reminder_mode_enabled: true,
    moments_mode_enabled: true,
    wake_word_enabled: true,
    idle_after_minutes: 60,
    sleep_after_minutes: 180,
  },
  health: {
    diagnostic_every_weeks: 2,
    self_diagnose_every_weeks: 2,
    health_report_every_months: 6,
    report_only_issues: true,
    keep_logs_locally: true,
  },
  ai_model: {
    selected_model: "gpt-5.4-mini",
  },
  trackers: {
    token_tracker_enabled: true,
    token_usage: 0,
    token_limit: 100000,
    token_limit_locked: false,
    tts_tracker_enabled: true,
    tts_usage: 0,
    tts_limit: 100000,
    tts_limit_locked: false,
  },
};

function deepMerge(base = {}, patch = {}) {
  const output = { ...base };

  Object.keys(patch || {}).forEach((key) => {
    if (
      patch[key] &&
      typeof patch[key] === "object" &&
      !Array.isArray(patch[key])
    ) {
      output[key] = deepMerge(base?.[key] || {}, patch[key]);
    } else {
      output[key] = patch[key];
    }
  });

  return output;
}

// GET /koibito-settings
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT settings_json, version
       FROM koibito_settings
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        settings: DEFAULT_KOIBITO_SETTINGS,
        version: 1,
      });
    }

    return res.json({
      success: true,
      settings: deepMerge(
        DEFAULT_KOIBITO_SETTINGS,
        result.rows[0].settings_json || {}
      ),
      version: result.rows[0].version || 1,
    });
  } catch (err) {
    console.error("GET koibito settings failed:", err);
    return res.status(500).json({
      message: "Failed to load Koibito settings",
    });
  }
});

// PATCH /koibito-settings
router.patch("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const patch = req.body || {};

  try {
    const existing = await pool.query(
      `SELECT settings_json, version
       FROM koibito_settings
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    const current =
      existing.rows.length > 0
        ? deepMerge(DEFAULT_KOIBITO_SETTINGS, existing.rows[0].settings_json || {})
        : DEFAULT_KOIBITO_SETTINGS;

    const mergedSettings = deepMerge(current, patch);
    const nextVersion = (existing.rows[0]?.version || 0) + 1;

    await pool.query(
      `INSERT INTO koibito_settings
        (user_id, settings_json, version, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
        settings_json = EXCLUDED.settings_json,
        version = EXCLUDED.version,
        updated_at = NOW()`,
      [userId, mergedSettings, nextVersion]
    );

    const devicesResult = await pool.query(
      `SELECT DISTINCT d.device_id
       FROM devices d
       JOIN koibitos k ON k.id = d.koibito_id
       WHERE k.user_id = $1
         AND d.device_id IS NOT NULL`,
      [userId]
    );

    for (const device of devicesResult.rows) {
      await pool.query(
        `INSERT INTO device_commands
          (device_id, command_type, payload, status, created_at)
         VALUES ($1, $2, $3, 'pending', NOW())`,
        [
          device.device_id,
          "config_patch",
          JSON.stringify({
            settings: mergedSettings,
            overwrite: true,
            scope: "global_koibito_settings",
          }),
        ]
      );
    }

    return res.json({
      success: true,
      settings: mergedSettings,
      version: nextVersion,
      pi_sync_queued: devicesResult.rows.length,
    });
  } catch (err) {
    console.error("PATCH koibito settings failed:", err);
    return res.status(500).json({
      message: "Failed to save Koibito settings",
    });
  }
});

module.exports = router;