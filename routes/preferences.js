const express = require("express");
const pool = require("../db");

const router = express.Router();

const DEFAULT_PREFERENCES = {
  app_theme: "liquid-glass",
  notifications_enabled: true,
  dark_mode: false,
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

function getUserId(req) {
  return req.user?.id || req.userId || req.auth?.user_id || req.body?.user_id;
}

router.get("/settings/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await pool.query(
      `SELECT preferences_json
       FROM user_preferences
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        preferences: DEFAULT_PREFERENCES,
      });
    }

    return res.json({
      preferences: deepMerge(
        DEFAULT_PREFERENCES,
        result.rows[0].preferences_json || {}
      ),
    });
  } catch (err) {
    console.error("GET preferences failed:", err);
    return res.status(500).json({ error: "Failed to load preferences" });
  }
});

router.patch("/settings/preferences", async (req, res) => {
  try {
    const userId = getUserId(req);
    const patch = req.body || {};

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const existing = await pool.query(
      `SELECT preferences_json
       FROM user_preferences
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    const current =
      existing.rows.length > 0
        ? deepMerge(DEFAULT_PREFERENCES, existing.rows[0].preferences_json || {})
        : DEFAULT_PREFERENCES;

    const mergedPreferences = deepMerge(current, patch);

    await pool.query(
      `INSERT INTO user_preferences
        (user_id, preferences_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
        preferences_json = EXCLUDED.preferences_json,
        updated_at = NOW()`,
      [userId, mergedPreferences]
    );

    return res.json({
      success: true,
      preferences: mergedPreferences,
    });
  } catch (err) {
    console.error("PATCH preferences failed:", err);
    return res.status(500).json({ error: "Failed to save preferences" });
  }
});

module.exports = router;