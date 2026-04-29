const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

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

    res.json({
      success: true,
      message: "Chat request approved",
      session: sessionResult.rows[0],
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

    res.json({
      success: true,
      message: "Session message sent",
      session_message: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send session message" });
  }
});

module.exports = router;