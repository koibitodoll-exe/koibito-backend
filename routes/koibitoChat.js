const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// helper
function toTimeString(date) {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// GET /chat/koibito/:id/thread
router.get("/koibito/:id/thread", authMiddleware, async (req, res) => {
  try {
    const koibitoId = req.params.id;
    const userId = req.user.id;

    // messages
    const messagesResult = await pool.query(
      `
      SELECT id, sender, text, is_action, created_at
      FROM koibito_messages
      WHERE koibito_id = $1 AND user_id = $2
      ORDER BY created_at ASC
      `,
      [koibitoId, userId]
    );

    const messages = messagesResult.rows.map((msg) => ({
      id: msg.id,
      text: msg.text,
      sender: msg.sender,
      timestamp: toTimeString(msg.created_at),
      isAction: msg.is_action,
    }));

    // streak
    const streakResult = await pool.query(
      `
      SELECT streak_count, days_lit, today_count, threshold, last_flame_date
      FROM koibito_streaks
      WHERE koibito_id = $1 AND user_id = $2
      LIMIT 1
      `,
      [koibitoId, userId]
    );

    const streakRow = streakResult.rows[0] || {
      streak_count: 0,
      days_lit: 0,
      today_count: 0,
      threshold: 50,
      last_flame_date: null,
    };

    res.json({
      koibito: {
        id: koibitoId,
        name: "Koibito",
        avatar: "💜",
        isPrimary: false,
        isConnected: true,
      },
      messages,
      streak: {
        daysLit: streakRow.days_lit || 0,
        streakCount: streakRow.streak_count || 0,
        todayCount: streakRow.today_count || 0,
        threshold: streakRow.threshold || 50,
      },
      pendingRequests: [],
    });
  } catch (error) {
    console.error("GET koibito thread failed:", error);
    res.status(500).json({ error: "Failed to load koibito thread" });
  }
});

// POST /chat/koibito/:id/messages
router.post("/koibito/:id/messages", authMiddleware, async (req, res) => {
  const client = await pool.connect();

  try {
    const koibitoId = req.params.id;
    const userId = req.user.id;
    const { text, sender = "me", isAction = false } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: "Message text is required" });
    }

    await client.query("BEGIN");

    const messageId = crypto.randomUUID();

    await client.query(
      `
      INSERT INTO koibito_messages (
        id, koibito_id, user_id, sender, text, is_action, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [messageId, koibitoId, userId, sender, text.trim(), !!isAction]
    );

    // streak row ensure exists
    const streakCheck = await client.query(
      `
      SELECT *
      FROM koibito_streaks
      WHERE koibito_id = $1 AND user_id = $2
      LIMIT 1
      `,
      [koibitoId, userId]
    );

    if (streakCheck.rows.length === 0) {
      await client.query(
        `
        INSERT INTO koibito_streaks (
          id, koibito_id, user_id, streak_count, days_lit, today_count, last_flame_date, threshold, updated_at
        )
        VALUES ($1, $2, $3, 0, 0, 0, NULL, 50, NOW())
        `,
        [crypto.randomUUID(), koibitoId, userId]
      );
    }

    // only non-action messages count toward streak
    if (!isAction) {
      const countResult = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM koibito_messages
        WHERE koibito_id = $1
          AND user_id = $2
          AND is_action = FALSE
          AND created_at::date = CURRENT_DATE
        `,
        [koibitoId, userId]
      );

      const todayCount = countResult.rows[0].count;

      const streakResult = await client.query(
        `
        SELECT *
        FROM koibito_streaks
        WHERE koibito_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [koibitoId, userId]
      );

      const streak = streakResult.rows[0];
      const threshold = streak.threshold || 50;
      const today = todayDateString();
      const lastFlameDate = streak.last_flame_date
        ? new Date(streak.last_flame_date).toISOString().slice(0, 10)
        : null;

      let streakCount = streak.streak_count || 0;
      let daysLit = streak.days_lit || 0;

      // light today's flame only once
      if (todayCount >= threshold && lastFlameDate !== today) {
        streakCount += 1;
        daysLit = Math.min(streakCount, 7);

        await client.query(
          `
          UPDATE koibito_streaks
          SET streak_count = $1,
              days_lit = $2,
              today_count = $3,
              last_flame_date = CURRENT_DATE,
              updated_at = NOW()
          WHERE koibito_id = $4 AND user_id = $5
          `,
          [streakCount, daysLit, todayCount, koibitoId, userId]
        );
      } else {
        await client.query(
          `
          UPDATE koibito_streaks
          SET today_count = $1,
              updated_at = NOW()
          WHERE koibito_id = $2 AND user_id = $3
          `,
          [todayCount, koibitoId, userId]
        );
      }
    }

    await client.query("COMMIT");

    // return fresh thread
    const messagesResult = await pool.query(
      `
      SELECT id, sender, text, is_action, created_at
      FROM koibito_messages
      WHERE koibito_id = $1 AND user_id = $2
      ORDER BY created_at ASC
      `,
      [koibitoId, userId]
    );

    const messages = messagesResult.rows.map((msg) => ({
      id: msg.id,
      text: msg.text,
      sender: msg.sender,
      timestamp: toTimeString(msg.created_at),
      isAction: msg.is_action,
    }));

    const streakResult = await pool.query(
      `
      SELECT streak_count, days_lit, today_count, threshold
      FROM koibito_streaks
      WHERE koibito_id = $1 AND user_id = $2
      LIMIT 1
      `,
      [koibitoId, userId]
    );

    const streakRow = streakResult.rows[0] || {
      streak_count: 0,
      days_lit: 0,
      today_count: 0,
      threshold: 50,
    };

    res.json({
      messages,
      streak: {
        daysLit: streakRow.days_lit || 0,
        streakCount: streakRow.streak_count || 0,
        todayCount: streakRow.today_count || 0,
        threshold: streakRow.threshold || 50,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST koibito message failed:", error);
    res.status(500).json({ error: "Failed to send koibito message" });
  } finally {
    client.release();
  }
});

// DELETE /chat/koibito/:id/messages
router.delete("/koibito/:id/messages", authMiddleware, async (req, res) => {
  try {
    const koibitoId = req.params.id;
    const userId = req.user.id;

    await pool.query(
      `
      DELETE FROM koibito_messages
      WHERE koibito_id = $1 AND user_id = $2
      `,
      [koibitoId, userId]
    );

    await pool.query(
      `
      UPDATE koibito_streaks
      SET today_count = 0,
          updated_at = NOW()
      WHERE koibito_id = $1 AND user_id = $2
      `,
      [koibitoId, userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE koibito messages failed:", error);
    res.status(500).json({ error: "Failed to clear koibito messages" });
  }
});

module.exports = router;