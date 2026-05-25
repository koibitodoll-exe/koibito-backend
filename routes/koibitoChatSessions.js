const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { generateReply } = require("../services/cloudBrain");
const { emitSessionUpdate } = require("../services/liveSync");

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

// POST /koibito-chat/request
router.post("/request", authMiddleware, async (req, res) => {
  const requesterUserId = req.user.id;
  const { owner_user_id, koibito_id, requested_duration_minutes = 60 } = req.body;

  if (!owner_user_id || !koibito_id) {
    return res.status(400).json({ message: "owner_user_id and koibito_id are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO koibito_chat_requests
       (requester_user_id, owner_user_id, koibito_id, requested_duration_minutes, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [requesterUserId, owner_user_id, koibito_id, requested_duration_minutes]
    );

    res.json({
      success: true,
      message: "Koibito chat request sent",
      request: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send koibito chat request" });
  }
});

// GET /koibito-chat/requests
router.get("/requests", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const incoming = await pool.query(
      `SELECT *
       FROM koibito_chat_requests
       WHERE owner_user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const outgoing = await pool.query(
      `SELECT *
       FROM koibito_chat_requests
       WHERE requester_user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      incoming: incoming.rows,
      outgoing: outgoing.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibito chat requests" });
  }
});

// POST /koibito-chat/request/:id/approve
router.post("/request/:id/approve", authMiddleware, async (req, res) => {
  const ownerUserId = req.user.id;
  const requestId = req.params.id;

  try {
    const requestResult = await pool.query(
      `SELECT *
       FROM koibito_chat_requests
       WHERE id = $1 AND owner_user_id = $2`,
      [requestId, ownerUserId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: "Chat request not found" });
    }

    const request = requestResult.rows[0];

    if (request.status !== "pending") {
      return res.status(400).json({ message: "Request is not pending" });
    }

    await pool.query(
      `UPDATE koibito_chat_requests
       SET status = 'approved', responded_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    const sessionResult = await pool.query(
      `INSERT INTO active_chat_sessions
       (request_id, requester_user_id, owner_user_id, koibito_id, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)
       RETURNING *`,
      [
        request.id,
        request.requester_user_id,
        request.owner_user_id,
        request.koibito_id,
        request.requested_duration_minutes,
      ]
    );

    const session = sessionResult.rows[0];

    if (typeof emitSessionUpdate === 'function') {
      emitSessionUpdate(session.id, 'session_created', { session });
    }

    res.json({
      success: true,
      message: "Chat request approved",
      session,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to approve chat request" });
  }
});

// POST /koibito-chat/request/:id/deny
router.post("/request/:id/deny", authMiddleware, async (req, res) => {
  const ownerUserId = req.user.id;
  const requestId = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE koibito_chat_requests
       SET status = 'denied', responded_at = NOW()
       WHERE id = $1 AND owner_user_id = $2 AND status = 'pending'
       RETURNING *`,
      [requestId, ownerUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Pending chat request not found" });
    }

    res.json({
      success: true,
      message: "Chat request denied",
      request: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to deny chat request" });
  }
});

// GET /koibito-chat/sessions
router.get("/sessions", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT *
       FROM active_chat_sessions
       WHERE (requester_user_id = $1 OR owner_user_id = $1)
         AND expires_at > NOW()
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      sessions: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch active chat sessions" });
  }
});

// GET /koibito-chat/sessions/:id/messages
router.get("/sessions/:id/messages", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const sessionId = req.params.id;

  try {
    const sessionCheck = await pool.query(
      `SELECT *
       FROM active_chat_sessions
       WHERE id = $1
         AND (requester_user_id = $2 OR owner_user_id = $2)
         AND expires_at > NOW()`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ message: "Active session not found" });
    }

    const result = await pool.query(
      `SELECT *
       FROM active_chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({
      success: true,
      messages: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch session messages" });
  }
});

// POST /koibito-chat/sessions/:id/message
router.post("/sessions/:id/message", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const sessionId = req.params.id;
  const { message_text, media_url = null } = req.body;

  try {
    const sessionCheck = await pool.query(
      `SELECT *
       FROM active_chat_sessions
       WHERE id = $1
         AND requester_user_id = $2
         AND expires_at > NOW()`,
      [sessionId, userId]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(403).json({ message: "You cannot send messages in this session" });
    }

    const result = await pool.query(
      `INSERT INTO active_chat_messages
       (session_id, sender_type, sender_id, message_text, media_url)
       VALUES ($1, 'user', $2, $3, $4)
       RETURNING *`,
      [sessionId, userId, message_text || null, media_url]
    );

    const sessionMessage = result.rows[0];
    const session = sessionCheck.rows[0];

    if (message_text && String(message_text).trim()) {
      let cloudReplyText = null;

      try {
        const brainResult = await processChatEvent({
          source: 'active_session',
          channel: 'active_session',
          eventType: 'chat.session.friend_message.created',
          userId,
          koibitoId: session.koibito_id,
          sessionId,
          message: String(message_text).trim(),
          senderType: 'user',
          metadata: {
            session_message: sessionMessage,
            requester_user_id: session.requester_user_id,
            owner_user_id: session.owner_user_id,
          },
        });

        cloudReplyText = brainResult.replyText;
      } catch (error) {
        console.log('Cloud Brain session reply skipped:', error.message);
      }

      if (cloudReplyText && String(cloudReplyText).trim()) {
        const replyResult = await pool.query(
          `INSERT INTO active_chat_messages
           (session_id, sender_type, sender_id, message_text, media_url)
           VALUES ($1, 'koibito', $2, $3, NULL)
           RETURNING *`,
          [sessionId, session.koibito_id, String(cloudReplyText).trim()]
        );

        if (typeof emitSessionUpdate === 'function') {
          emitSessionUpdate(sessionId, 'message_created', { message: replyResult.rows[0] });
        }
      }
    }

    if (typeof emitSessionUpdate === 'function') {
      emitSessionUpdate(sessionId, 'message_created', { message: sessionMessage });
    }

    res.json({
      success: true,
      message: "Session message sent",
      session_message: sessionMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send session message" });
  }
});

module.exports = router;