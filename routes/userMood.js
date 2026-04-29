const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// POST /user/mood-checkin
router.post("/mood-checkin", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { koibito_id, mood_label, mood_note, source, submitted_at } = req.body;

    if (!mood_label || typeof mood_label !== "string") {
      return res.status(400).json({ error: "mood_label is required" });
    }

    const cleanMoodLabel = mood_label.trim();
    const cleanMoodNote = typeof mood_note === "string" ? mood_note.trim() : "";
    const cleanSource =
      typeof source === "string" && source.trim()
        ? source.trim()
        : "home_checkin";

    if (!cleanMoodLabel) {
      return res.status(400).json({ error: "mood_label cannot be empty" });
    }

    const moodWords = cleanMoodNote.split(/\s+/).filter(Boolean);
    if (moodWords.length > 50) {
      return res.status(400).json({ error: "mood_note cannot exceed 50 words" });
    }

    const submittedAt = submitted_at ? new Date(submitted_at) : new Date();

    if (Number.isNaN(submittedAt.getTime())) {
      return res.status(400).json({ error: "submitted_at is invalid" });
    }

    // one mood entry per user per day, update if already exists
    const existingMood = await pool.query(
      `
      SELECT id
      FROM user_mood_checkins
      WHERE user_id = $1
        AND DATE(submitted_at) = DATE($2)
      ORDER BY submitted_at DESC
      LIMIT 1
      `,
      [userId, submittedAt]
    );

    let savedMood;

    if (existingMood.rows.length > 0) {
      const updated = await pool.query(
        `
        UPDATE user_mood_checkins
        SET
          koibito_id = $1,
          mood_label = $2,
          mood_note = $3,
          source = $4,
          submitted_at = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
        `,
        [
          koibito_id || null,
          cleanMoodLabel,
          cleanMoodNote || null,
          cleanSource,
          submittedAt,
          existingMood.rows[0].id,
        ]
      );

      savedMood = updated.rows[0];
    } else {
      const inserted = await pool.query(
        `
        INSERT INTO user_mood_checkins
          (user_id, koibito_id, mood_label, mood_note, source, submitted_at)
        VALUES
          ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [
          userId,
          koibito_id || null,
          cleanMoodLabel,
          cleanMoodNote || null,
          cleanSource,
          submittedAt,
        ]
      );

      savedMood = inserted.rows[0];
    }

    // optional: queue Pi sync command if koibito_id exists
    if (koibito_id) {
      await pool.query(
        `
        INSERT INTO device_commands (device_id, command_type, payload, status, created_at)
        SELECT
          d.device_id,
          'config_patch',
          $1::jsonb,
          'pending',
          NOW()
        FROM devices d
        WHERE d.koibito_id = $2
        `,
        [
          JSON.stringify({
            owner_mood_today: {
              label: savedMood.mood_label,
              note: savedMood.mood_note,
              source: savedMood.source,
              submitted_at: savedMood.submitted_at,
            },
          }),
          koibito_id,
        ]
      );
    }

    return res.status(200).json({
      success: true,
      mood: savedMood,
    });
  } catch (error) {
    console.error("POST /user/mood-checkin error:", error);
    return res.status(500).json({ error: "Failed to save mood check-in" });
  }
});

// GET /user/mood-checkin/today
router.get("/mood-checkin/today", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT *
      FROM user_mood_checkins
      WHERE user_id = $1
        AND DATE(submitted_at) = CURRENT_DATE
      ORDER BY submitted_at DESC
      LIMIT 1
      `,
      [userId]
    );

    return res.status(200).json({
      success: true,
      mood: result.rows[0] || null,
    });
  } catch (error) {
    console.error("GET /user/mood-checkin/today error:", error);
    return res.status(500).json({ error: "Failed to fetch today's mood" });
  }
});

module.exports = router;