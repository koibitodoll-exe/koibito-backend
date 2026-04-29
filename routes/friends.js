const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

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

  console.log("content-type:", req.headers["content-type"]);
  console.log("req.body:", req.body);

  if (!receiver_user_id) {
    return res.status(400).json({ message: "receiver_user_id is required" });
  }

  if (Number(receiver_user_id) === Number(senderUserId)) {
    return res.status(400).json({ message: "You cannot friend yourself" });
  }

  try {
    const existingFriendship = await pool.query(
      `SELECT id FROM friendships
       WHERE (user_a = $1 AND user_b = $2)
          OR (user_a = $2 AND user_b = $1)`,
      [senderUserId, receiver_user_id]
    );

    if (existingFriendship.rows.length > 0) {
      return res.status(400).json({ message: "Already friends" });
    }

    const existingRequest = await pool.query(
      `SELECT id, status FROM friend_requests
       WHERE sender_user_id = $1 AND receiver_user_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [senderUserId, receiver_user_id]
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
      [senderUserId, receiver_user_id]
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

// GET /friends/search/:contact_code
router.get("/search/:contact_code", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const contactCode = req.params.contact_code;

  try {
    const result = await pool.query(
      `SELECT id, email, contact_code
       FROM users
       WHERE contact_code = $1 AND id != $2`,
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