const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// POST /chat/rooms
router.post("/rooms", authMiddleware, async (req, res) => {
  const { room_type, participants = [] } = req.body;

  if (!room_type) {
    return res.status(400).json({ message: "room_type is required" });
  }

  try {
    const roomResult = await pool.query(
      `INSERT INTO chat_rooms (room_type)
       VALUES ($1)
       RETURNING *`,
      [room_type]
    );

    const room = roomResult.rows[0];

    for (const p of participants) {
      await pool.query(
        `INSERT INTO chat_participants (room_id, participant_type, participant_id)
         VALUES ($1, $2, $3)`,
        [room.id, p.participant_type, p.participant_id]
      );
    }

    res.json({
      success: true,
      message: "Chat room created",
      room,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create chat room" });
  }
});

// GET /chat/rooms
router.get("/rooms", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT DISTINCT
         cr.id,
         cr.room_type,
         cr.created_at
       FROM chat_rooms cr
       JOIN chat_participants cp ON cp.room_id = cr.id
       WHERE cp.participant_type = 'user' AND cp.participant_id = $1
       ORDER BY cr.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      rooms: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch chat rooms" });
  }
});

// GET /chat/rooms/:id/messages
router.get("/rooms/:id/messages", authMiddleware, async (req, res) => {
  const roomId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT
         id,
         room_id,
         sender_type,
         sender_id,
         message_text,
         media_url,
         message_type,
         action_type,
         target_id,
         created_at
       FROM chat_messages
       WHERE room_id = $1
       ORDER BY created_at ASC`,
      [roomId]
    );

    res.json({
      success: true,
      messages: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

// POST /chat/rooms/:id/message
router.post("/rooms/:id/message", authMiddleware, async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const {
    message_text = null,
    media_url = null,
    message_type = "text",
    action_type = null,
    target_id = null,
  } = req.body;

  try {
    const participantCheck = await pool.query(
      `SELECT id
       FROM chat_participants
       WHERE room_id = $1
         AND participant_type = 'user'
         AND participant_id = $2`,
      [roomId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not part of this room" });
    }

    const result = await pool.query(
      `INSERT INTO chat_messages
       (room_id, sender_type, sender_id, message_text, media_url, message_type, action_type, target_id)
       VALUES ($1, 'user', $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [roomId, userId, message_text, media_url, message_type, action_type, target_id]
    );

    res.json({
      success: true,
      message: "Message sent",
      chat_message: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send message" });
  }
});

// POST /chat/rooms/:id/read
router.post("/rooms/:id/read", authMiddleware, async (req, res) => {
  const roomId = req.params.id;
  const userId = req.user.id;
  const { last_read_message_id } = req.body;

  try {
    const participantCheck = await pool.query(
      `SELECT id
       FROM chat_participants
       WHERE room_id = $1
         AND participant_type = 'user'
         AND participant_id = $2`,
      [roomId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not part of this room" });
    }

    const result = await pool.query(
      `INSERT INTO chat_reads (room_id, user_id, last_read_message_id, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET
         last_read_message_id = EXCLUDED.last_read_message_id,
         updated_at = NOW()
       RETURNING *`,
      [roomId, userId, last_read_message_id]
    );

    res.json({
      success: true,
      message: "Read state updated",
      read_state: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update read state" });
  }
});

// GET /chat/settings
router.get("/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         user_id,
         send_with_enter,
         show_timestamps,
         voicenote_autoplay,
         media_auto_download,
         chat_font_size,
         default_chat_session_expiry,
         updated_at
       FROM user_chat_settings
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      settings: result.rows[0] || {
        user_id: userId,
        send_with_enter: true,
        show_timestamps: true,
        voicenote_autoplay: false,
        media_auto_download: false,
        chat_font_size: "medium",
        default_chat_session_expiry: 60,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch chat settings" });
  }
});

// PATCH /chat/settings
router.patch("/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    send_with_enter = true,
    show_timestamps = true,
    voicenote_autoplay = false,
    media_auto_download = false,
    chat_font_size = "medium",
    default_chat_session_expiry = 60,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_chat_settings
       (user_id, send_with_enter, show_timestamps, voicenote_autoplay, media_auto_download, chat_font_size, default_chat_session_expiry, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         send_with_enter = EXCLUDED.send_with_enter,
         show_timestamps = EXCLUDED.show_timestamps,
         voicenote_autoplay = EXCLUDED.voicenote_autoplay,
         media_auto_download = EXCLUDED.media_auto_download,
         chat_font_size = EXCLUDED.chat_font_size,
         default_chat_session_expiry = EXCLUDED.default_chat_session_expiry,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        send_with_enter,
        show_timestamps,
        voicenote_autoplay,
        media_auto_download,
        chat_font_size,
        default_chat_session_expiry,
      ]
    );

    res.json({
      success: true,
      message: "Chat settings updated",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update chat settings" });
  }
});

module.exports = router;