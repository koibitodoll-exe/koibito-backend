const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { processEvent } = require("../services/eventProcessor");

// GET /friends/requests
router.get("/requests", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const incoming = await pool.query(
      `SELECT * FROM friend_requests
       WHERE receiver_user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const outgoing = await pool.query(
      `SELECT * FROM friend_requests
       WHERE sender_user_id = $1
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
    res.status(500).json({ message: "Failed to fetch friend requests" });
  }
});

// POST /friends/request
router.post("/request", authMiddleware, async (req, res) => {
  const senderUserId = req.user.id;
  const receiver_user_id = req.body?.receiver_user_id;
  const contact_code = req.body?.contact_code?.trim()?.toUpperCase();

  console.log("content-type:", req.headers["content-type"]);
  console.log("req.body:", req.body);

  try {
    let targetUserId = receiver_user_id;

    // QR scan and manual code entry both send contact_code.
    // This keeps the backend path identical for both add-contact methods.
    if (!targetUserId && contact_code) {
      const userLookup = await pool.query(
        `SELECT id
         FROM users
         WHERE contact_code = $1
           AND COALESCE(entity_type, 'human') = 'human'
         LIMIT 1`,
        [contact_code]
      );

      if (userLookup.rows.length === 0) {
        return res.status(404).json({ message: "Contact code not found" });
      }

      targetUserId = userLookup.rows[0].id;
    }

    if (!targetUserId) {
      return res.status(400).json({
        message: "receiver_user_id or contact_code is required",
      });
    }

    if (Number(targetUserId) === Number(senderUserId)) {
      return res.status(400).json({ message: "You cannot friend yourself" });
    }

    const existingFriendship = await pool.query(
      `SELECT id FROM friendships
       WHERE (user_a = $1 AND user_b = $2)
          OR (user_a = $2 AND user_b = $1)`,
      [senderUserId, targetUserId]
    );

    if (existingFriendship.rows.length > 0) {
      return res.status(400).json({ message: "Already friends" });
    }

    const existingRequest = await pool.query(
      `SELECT id, status FROM friend_requests
       WHERE sender_user_id = $1 AND receiver_user_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [senderUserId, targetUserId]
    );

    if (
      existingRequest.rows.length > 0 &&
      existingRequest.rows[0].status === "pending"
    ) {
      return res.status(400).json({ message: "Friend request already pending" });
    }

    const result = await pool.query(
      `INSERT INTO friend_requests (sender_user_id, receiver_user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING *`,
      [senderUserId, targetUserId]
    );

    await pool.query(
      `INSERT INTO notifications (
         user_id,
         type,
         title,
         body,
         action_route,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        targetUserId,
        "friend_request",
        "New friend request",
        "Someone sent you a friend request.",
        "/requests",
        JSON.stringify({
          request_id: result.rows[0].id,
          sender_user_id: senderUserId,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Friend request sent",
      request: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send friend request" });
  }
});

// POST /friends/request/:id/accept
router.post("/request/:id/accept", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const requestId = req.params.id;

  try {
    const requestResult = await pool.query(
      `SELECT * FROM friend_requests
       WHERE id = $1 AND receiver_user_id = $2`,
      [requestId, userId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: "Friend request not found" });
    }

    const request = requestResult.rows[0];

    if (request.status !== "pending") {
      return res.status(400).json({ message: "Request is not pending" });
    }

    await pool.query(
      `UPDATE friend_requests
       SET status = 'accepted', responded_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    await pool.query(
      `INSERT INTO friendships (user_a, user_b)
       VALUES ($1, $2)`,
      [request.sender_user_id, request.receiver_user_id]
    );

    await pool.query(
      `INSERT INTO notifications (
         user_id,
         type,
         title,
         body,
         action_route,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        request.sender_user_id,
        "friend_request_accepted",
        "Friend request accepted",
        "Your friend request was accepted.",
        "/contacts",
        JSON.stringify({
          request_id: request.id,
          accepted_by_user_id: userId,
        }),
      ]
    );

    try {
      await processEvent({
        user_id: userId,
        koibito_id: null,
        event_type: 'social.friend_added',
        source: 'friends',
      });
    } catch(eventErr){
      console.warn('[friends] event processing failed:', eventErr.message);
    }

    res.json({
      success: true,
      message: "Friend request accepted",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to accept friend request" });
  }
});

// POST /friends/request/:id/decline
router.post("/request/:id/decline", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const requestId = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE friend_requests
       SET status = 'declined', responded_at = NOW()
       WHERE id = $1 AND receiver_user_id = $2 AND status = 'pending'
       RETURNING *`,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Pending friend request not found" });
    }

    res.json({
      success: true,
      message: "Friend request declined",
      request: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to decline friend request" });
  }
});

// POST /friends/request/:id/cancel
router.post("/request/:id/cancel", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const requestId = req.params.id;

  try {
    const result = await pool.query(
      `UPDATE friend_requests
       SET status = 'cancelled', responded_at = NOW()
       WHERE id = $1 AND sender_user_id = $2 AND status = 'pending'
       RETURNING *`,
      [requestId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Pending sent request not found" });
    }

    res.json({
      success: true,
      message: "Friend request cancelled",
      request: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to cancel friend request" });
  }
});

// GET /friends
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         f.id AS friendship_id,
         CASE
           WHEN f.user_a = $1 THEN u2.id
           ELSE u1.id
         END AS friend_user_id,
         CASE
           WHEN f.user_a = $1 THEN u2.email
           ELSE u1.email
         END AS friend_email,
         CASE
           WHEN f.user_a = $1 THEN u2.username
           ELSE u1.username
         END AS friend_username,
         CASE
           WHEN f.user_a = $1 THEN u2.full_name
           ELSE u1.full_name
         END AS friend_display_name,
         CASE
           WHEN f.user_a = $1 THEN u2.contact_code
           ELSE u1.contact_code
         END AS friend_contact_code,
         f.created_at
       FROM friendships f
       JOIN users u1 ON u1.id = f.user_a
       JOIN users u2 ON u2.id = f.user_b
       WHERE f.user_a = $1 OR f.user_b = $1
       ORDER BY f.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      friends: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch friends list" });
  }
});

// DELETE /friends/:friend_user_id
router.delete("/:friend_user_id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const friendUserId = req.params.friend_user_id;

  if (!friendUserId) {
    return res.status(400).json({ message: "friend_user_id is required" });
  }

  if (Number(friendUserId) === Number(userId)) {
    return res.status(400).json({ message: "You cannot remove yourself" });
  }

  try {
    const result = await pool.query(
      `DELETE FROM friendships
       WHERE (user_a = $1 AND user_b = $2)
          OR (user_a = $2 AND user_b = $1)
       RETURNING *`,
      [userId, friendUserId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Friendship not found" });
    }

    await pool.query(
      `INSERT INTO notifications (
         user_id,
         type,
         title,
         body,
         action_route,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        friendUserId,
        "friend_removed",
        "Contact removed",
        "A contact connection was removed.",
        "/contacts",
        JSON.stringify({
          removed_by_user_id: userId,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Contact removed",
      friendship: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove contact" });
  }
});

// GET /friends/search/:contact_code
router.get("/search/:contact_code", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const contactCode = req.params.contact_code?.trim()?.toUpperCase();

  try {
    const result = await pool.query(
      `SELECT id, email, username, full_name, contact_code
       FROM users
       WHERE contact_code = $1
         AND id != $2
         AND COALESCE(entity_type, 'human') = 'human'
       LIMIT 1`,
      [contactCode, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to search contact code" });
  }
});

module.exports = router; 

