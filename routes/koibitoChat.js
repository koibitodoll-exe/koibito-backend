const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { generateReply } = require("../services/cloudBrain");
const { emitKoibitoChatUpdate } = require("../services/liveSync");

async function processChatEvent(event) {
  try {
    await pool.query(
      `INSERT INTO interaction_events (user_id, koibito_id, event_type, source, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        event.userId || null,
        event.koibitoId || null,
        event.eventType || 'chat.message.created',
        event.source || event.channel || 'chat',
        JSON.stringify({
          channel: event.channel,
          message: event.message,
          sender_type: event.senderType,
          room_id: event.roomId,
          group_id: event.groupId,
          session_id: event.sessionId,
          metadata: event.metadata || {},
        }),
      ]
    );
  } catch (error) {
    console.log('interaction_events insert skipped:', error.message);
  }

  if (event.skipReply || !event.koibitoId || !event.userId || !event.message) {
    return { replyText: null };
  }

  try {
    const brainResult = await generateReply({
      koibitoId: event.koibitoId,
      userId: event.userId,
      userMessage: event.message,
    });

    return {
      replyText: brainResult?.reply || null,
      packet: brainResult?.packet || null,
    };
  } catch (error) {
    console.log('Cloud Brain generateReply skipped:', error.message);
    return { replyText: null };
  }
}

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

    let cloudReplyText = null;

    if (sender === "me" && !isAction) {
      try {
        const brainResult = await processChatEvent({
          source: 'koibito_chat',
          channel: 'koibito_chat',
          eventType: 'chat.koibito.user_message.created',
          userId,
          koibitoId,
          message: text.trim(),
          senderType: 'user',
          metadata: {
            message_id: messageId,
            is_action: !!isAction,
          },
        });

        cloudReplyText = brainResult.replyText;
      } catch (error) {
        console.log('Cloud Brain koibito reply skipped:', error.message);
      }
    } else {
      await processChatEvent({
        source: 'koibito_chat',
        channel: 'koibito_chat',
        eventType: isAction ? 'chat.koibito.action.created' : 'chat.koibito.message.created',
        userId,
        koibitoId,
        message: text.trim(),
        senderType: sender,
        skipReply: true,
        metadata: {
          message_id: messageId,
          is_action: !!isAction,
        },
      });
    }

    if (cloudReplyText && String(cloudReplyText).trim()) {
      await pool.query(
        `
        INSERT INTO koibito_messages (
          id, koibito_id, user_id, sender, text, is_action, created_at
        )
        VALUES ($1, $2, $3, 'them', $4, FALSE, NOW())
        `,
        [crypto.randomUUID(), koibitoId, userId, String(cloudReplyText).trim()]
      );
    }

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

    const streakPayload = {
      daysLit: streakRow.days_lit || 0,
      streakCount: streakRow.streak_count || 0,
      todayCount: streakRow.today_count || 0,
      threshold: streakRow.threshold || 50,
    };

    if (typeof emitKoibitoChatUpdate === 'function') {
      emitKoibitoChatUpdate(koibitoId, userId, 'message_created', {
        messages,
        streak: streakPayload,
      });
    }

    res.json({
      messages,
      streak: streakPayload,
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

    if (typeof emitKoibitoChatUpdate === 'function') {
      emitKoibitoChatUpdate(koibitoId, userId, 'messages_cleared', {
        koibito_id: koibitoId,
        user_id: userId,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE koibito messages failed:", error);
    res.status(500).json({ error: "Failed to clear koibito messages" });
  }
});

module.exports = router;