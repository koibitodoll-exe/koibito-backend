const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { generateReply } = require("../services/cloudBrain");
const { emitGroupUpdate } = require("../services/liveSync");

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

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(group.id, 'group_created', { group });
    }

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
    const memberCheck = await pool.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ message: "Only group members can invite members" });
    }

    await pool.query(
      `INSERT INTO group_members (group_id, member_type, member_id, role)
       VALUES ($1, $2, $3, 'member')`,
      [groupId, member_type, member_id]
    );

    // Notification insert
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
        member_id,
        "group_invite",
        "Group invite",
        "You were added to a group.",
        "/groups",
        JSON.stringify({
          group_id: groupId,
          invited_by: userId,
        }),
      ]
    );

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'member_invited', {
        member_type,
        member_id,
        invited_by: userId,
      });
    }

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

    const groupMessage = result.rows[0];

    await processChatEvent({
      source: 'group_chat',
      channel: 'group_chat',
      eventType: 'chat.group_message.created',
      userId,
      groupId,
      message: message_text,
      senderType: 'user',
      skipReply: true,
      metadata: {
        group_message: groupMessage,
        media_url,
      },
    });

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'message_created', { message: groupMessage });
    }

    res.json({
      success: true,
      message: "Group message sent",
      group_message: groupMessage,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send group message" });
  }
});


// POST /groups/:id/remove-member
router.post("/:id/remove-member", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;
  const { member_type = "user", member_id } = req.body;

  if (!member_id) {
    return res.status(400).json({ message: "member_id is required" });
  }

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
      return res.status(403).json({ message: "Only owner can remove members" });
    }

    const targetCheck = await pool.query(
      `SELECT role FROM group_members
       WHERE group_id = $1
         AND member_type = $2
         AND member_id = $3
       LIMIT 1`,
      [groupId, member_type, member_id]
    );

    if (targetCheck.rows.length === 0) {
      return res.status(404).json({ message: "Member not found in group" });
    }

    if (targetCheck.rows[0].role === "owner") {
      return res.status(400).json({ message: "Owner cannot be removed" });
    }

    await pool.query(
      `DELETE FROM group_members
       WHERE group_id = $1
         AND member_type = $2
         AND member_id = $3`,
      [groupId, member_type, member_id]
    );

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'member_removed', {
        member_type,
        member_id,
        removed_by: userId,
      });
    }

    res.json({
      success: true,
      message: "Member removed from group",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to remove member" });
  }
});

// POST /groups/:id/leave
router.post("/:id/leave", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;

  try {
    const memberCheck = await pool.query(
      `SELECT role FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2
       LIMIT 1`,
      [groupId, userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.status(404).json({ message: "You are not in this group" });
    }

    if (memberCheck.rows[0].role === "owner") {
      return res.status(400).json({
        message: "Owner cannot leave. Disband the group or transfer ownership first.",
      });
    }

    await pool.query(
      `DELETE FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2`,
      [groupId, userId]
    );

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'member_left', {
        member_type: 'user',
        member_id: userId,
      });
    }

    res.json({
      success: true,
      message: "Left group",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to leave group" });
  }
});

// DELETE /groups/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const groupId = req.params.id;

  const client = await pool.connect();

  try {
    const ownerCheck = await client.query(
      `SELECT id FROM group_members
       WHERE group_id = $1
         AND member_type = 'user'
         AND member_id = $2
         AND role = 'owner'`,
      [groupId, userId]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "Only owner can disband group" });
    }

    await client.query("BEGIN");

    await client.query(`DELETE FROM group_messages WHERE group_id = $1`, [groupId]);
    await client.query(`DELETE FROM group_settings WHERE group_id = $1`, [groupId]);
    await client.query(`DELETE FROM group_members WHERE group_id = $1`, [groupId]);
    await client.query(`DELETE FROM groups WHERE id = $1`, [groupId]);

    await client.query("COMMIT");

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'group_disbanded', {
        group_id: groupId,
        disbanded_by: userId,
      });
    }

    res.json({
      success: true,
      message: "Group disbanded",
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to disband group" });
  } finally {
    client.release();
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

    const settings = result.rows[0];

    if (typeof emitGroupUpdate === 'function') {
      emitGroupUpdate(groupId, 'settings_updated', { settings });
    }

    res.json({
      success: true,
      message: "Group settings updated",
      settings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update group settings" });
  }
});

module.exports = router;