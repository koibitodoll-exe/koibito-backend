const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// POST /groups
router.post("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { name, members = [] } = req.body;

  if (!name) {
    return res.status(400).json({ message: "name is required" });
  }

  try {
    const groupResult = await pool.query(
      `INSERT INTO groups (name, created_by)
       VALUES ($1, $2)
       RETURNING *`,
      [name, userId]
    );

    const group = groupResult.rows[0];

    await pool.query(
      `INSERT INTO group_members (group_id, member_type, member_id, role)
       VALUES ($1, 'user', $2, 'owner')`,
      [group.id, userId]
    );

    for (const member of members) {
      await pool.query(
        `INSERT INTO group_members (group_id, member_type, member_id, role)
         VALUES ($1, $2, $3, 'member')`,
        [group.id, member.member_type, member.member_id]
      );
    }

    await pool.query(
      `INSERT INTO group_settings (group_id)
       VALUES ($1)`,
      [group.id]
    );

    res.json({
      success: true,
      message: "Group created",
      group,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create group" });
  }
});

// GET /groups
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT DISTINCT g.*
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.member_type = 'user' AND gm.member_id = $1
       ORDER BY g.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      groups: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch groups" });
  }
});

// POST /groups/:id/invite
router.post("/:id/invite", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;
  const { member_type, member_id } = req.body;

  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2
         AND role = 'owner'`,
      [groupId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "Only owner can invite members" });
    }

    await pool.query(
      `INSERT INTO group_members (group_id, member_type, member_id, role)
       VALUES ($1, $2, $3, 'member')`,
      [groupId, member_type, member_id]
    );

    res.json({
      success: true,
      message: "Member added to group",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to invite member" });
  }
});

// GET /groups/:id/messages
router.get("/:id/messages", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;

  try {
    const memberCheck = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not in this group" });
    }

    const result = await pool.query(
      `SELECT *
       FROM group_messages
       WHERE group_id = $1
       ORDER BY created_at ASC`,
      [groupId]
    );

    res.json({
      success: true,
      messages: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch group messages" });
  }
});

// POST /groups/:id/message
router.post("/:id/message", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;
  const { message_text, media_url = null } = req.body;

  try {
    const memberCheck = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not in this group" });
    }

    const result = await pool.query(
      `INSERT INTO group_messages (group_id, sender_type, sender_id, message_text, media_url)
       VALUES ($1, 'user', $2, $3, $4)
       RETURNING *`,
      [groupId, userId, message_text || null, media_url]
    );

    res.json({
      success: true,
      message: "Group message sent",
      group_message: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send group message" });
  }
});

// PATCH /groups/:id/settings
router.patch("/:id/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;
  const {
    chat_mode = "normal",
    active_speaker = null,
    mention_required = false,
    reply_frequency = "normal",
    timer_limit = null,
    mute = false,
  } = req.body;

  try {
    const ownerCheck = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2
         AND role = 'owner'`,
      [groupId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "Only owner can update settings" });
    }

    const result = await pool.query(
      `UPDATE group_settings
       SET chat_mode = $1,
           active_speaker = $2,
           mention_required = $3,
           reply_frequency = $4,
           timer_limit = $5,
           mute = $6,
           updated_at = NOW()
       WHERE group_id = $7
       RETURNING *`,
      [chat_mode, active_speaker, mention_required, reply_frequency, timer_limit, mute, groupId]
    );

    res.json({
      success: true,
      message: "Group settings updated",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update group settings" });
  }
});

module.exports = router;