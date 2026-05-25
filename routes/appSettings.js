const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { processEvent } = require("../services/eventProcessor");

// GET /app-settings
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const prefResult = await pool.query(
      `SELECT user_id, dark_mode, notifications_enabled, updated_at
       FROM user_preferences
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      preferences: prefResult.rows[0] || {
        user_id: userId,
        dark_mode: false,
        notifications_enabled: true,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch app settings" });
  }
});

// PATCH /app-settings/preferences
router.patch("/preferences", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    dark_mode = false,
    notifications_enabled = true,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_preferences (user_id, dark_mode, notifications_enabled, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         dark_mode = EXCLUDED.dark_mode,
         notifications_enabled = EXCLUDED.notifications_enabled,
         updated_at = NOW()
       RETURNING *`,
      [userId, dark_mode, notifications_enabled]
    );

    try {
      await processEvent({
        user_id: userId,
        koibito_id: null,
        event_type: 'settings.theme_changed',
        source: 'app_settings',
      });
    } catch(eventErr){
      console.warn('[settings] event processing failed:', eventErr.message);
    }

    res.json({
      success: true,
      message: "Preferences updated",
      preferences: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update preferences" });
  }
});

// GET /app-settings/system
router.get("/system", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT user_id, app_version, storage_used, updated_at
       FROM app_system
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      system: result.rows[0] || {
        user_id: userId,
        app_version: null,
        storage_used: null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch system settings" });
  }
});

// POST /app-settings/clear-cache
router.post("/clear-cache", authMiddleware, async (req, res) => {
  res.json({
    success: true,
    message: "Clear cache should be handled app-side",
  });
});

// GET /app-settings/check-updates
router.get("/check-updates", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT app_version
       FROM app_system
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      current_version: result.rows[0]?.app_version || null,
      update_available: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to check updates" });
  }
});

module.exports = router;