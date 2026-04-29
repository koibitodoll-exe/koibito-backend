const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const notify = require("../utils/notify");

const MAX_KOIBITO_COMMENTS_PER_ENTRY = 5;

async function hasColumn(tableName, columnName) {
  const result = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2
     LIMIT 1`,
    [tableName, columnName]
  );

  return result.rows.length > 0;
}

async function getPrimaryKoibitoForUser(userId) {
  const hasIsPrimary = await hasColumn("koibitos", "is_primary");
  const hasPrimary = await hasColumn("koibitos", "primary");
  const hasPairedAt = await hasColumn("koibitos", "paired_at");
  const hasCreatedAt = await hasColumn("koibitos", "created_at");

  if (hasIsPrimary) {
    const result = await pool.query(
      `SELECT id, name
       FROM koibitos
       WHERE user_id = $1
       ORDER BY is_primary DESC, ${hasPairedAt ? "paired_at ASC NULLS LAST," : ""} ${hasCreatedAt ? "created_at ASC NULLS LAST," : ""} id ASC
       LIMIT 1`,
      [userId]
    );

    return result.rows[0] || null;
  }

  if (hasPrimary) {
    const result = await pool.query(
      `SELECT id, name
       FROM koibitos
       WHERE user_id = $1
       ORDER BY primary DESC, ${hasPairedAt ? "paired_at ASC NULLS LAST," : ""} ${hasCreatedAt ? "created_at ASC NULLS LAST," : ""} id ASC
       LIMIT 1`,
      [userId]
    );

    return result.rows[0] || null;
  }

  if (hasPairedAt) {
    const result = await pool.query(
      `SELECT id, name
       FROM koibitos
       WHERE user_id = $1
       ORDER BY paired_at ASC NULLS LAST, ${hasCreatedAt ? "created_at ASC NULLS LAST," : ""} id ASC
       LIMIT 1`,
      [userId]
    );

    return result.rows[0] || null;
  }

  if (hasCreatedAt) {
    const result = await pool.query(
      `SELECT id, name
       FROM koibitos
       WHERE user_id = $1
       ORDER BY created_at ASC NULLS LAST, id ASC
       LIMIT 1`,
      [userId]
    );

    return result.rows[0] || null;
  }

  const fallbackResult = await pool.query(
    `SELECT id, name
     FROM koibitos
     WHERE user_id = $1
     ORDER BY id ASC
     LIMIT 1`,
    [userId]
  );

  return fallbackResult.rows[0] || null;
}

async function getKoibitoForUser(userId, koibitoId) {
  const result = await pool.query(
    `SELECT id, name
     FROM koibitos
     WHERE id = $1 AND user_id = $2`,
    [koibitoId, userId]
  );

  return result.rows[0] || null;
}


async function getDiaryModeForKoibito(koibitoId) {
  const result = await pool.query(
    `SELECT diary_mode
     FROM koibito_settings
     WHERE koibito_id = $1
     LIMIT 1`,
    [koibitoId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  return Boolean(result.rows[0].diary_mode);
}

async function getPrimaryKoibitoWithDiaryMode(userId) {
  const primaryKoibito = await getPrimaryKoibitoForUser(userId);

  if (!primaryKoibito) {
    return {
      primaryKoibito: null,
      diaryModeEnabled: false,
    };
  }

  const diaryModeEnabled = await getDiaryModeForKoibito(primaryKoibito.id);

  return {
    primaryKoibito,
    diaryModeEnabled,
  };
}


function isUserCommentPayload(body) {
  const commenterType = String(body?.commenter_type || "").toLowerCase();
  const koibitoId = body?.koibito_id;
  const koibitoName = String(body?.koibito_name || "").trim().toLowerCase();

  return (
    commenterType === "user" ||
    koibitoId === 0 ||
    koibitoId === "0" ||
    koibitoId === null ||
    koibitoId === undefined ||
    koibitoName === "you"
  );
}

function mapDiaryComment(comment) {
  const isUserComment =
    comment.koibito_id === null ||
    comment.koibito_id === undefined ||
    String(comment.koibito_id) === "0" ||
    String(comment.koibito_name || "").trim().toLowerCase() === "you";

  return {
    ...comment,
    commenter_type: isUserComment ? "user" : "koibito",
  };
}

// GET /diary/user
router.get("/user", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT id, user_id, entry_text, date, created_at
       FROM user_diary_entries
       WHERE user_id = $1
       ORDER BY date DESC, created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      entries: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch user diary entries" });
  }
});

// POST /diary/user
router.post("/user", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { entry_text, date } = req.body;

  if (!entry_text || !date) {
    return res.status(400).json({ message: "entry_text and date are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO user_diary_entries (user_id, entry_text, date)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, entry_text, date]
    );

    res.json({
      success: true,
      message: "User diary entry created",
      entry: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create user diary entry" });
  }
});

// POST /diary/koibito
router.post("/koibito", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { koibito_id, koibito_name, entry_text, date } = req.body;

  if (!koibito_id || !koibito_name || !entry_text || !date) {
    return res.status(400).json({
      message: "koibito_id, koibito_name, entry_text, and date are required",
    });
  }

  try {
    const { primaryKoibito, diaryModeEnabled } = await getPrimaryKoibitoWithDiaryMode(userId);

    if (!primaryKoibito) {
      return res.status(404).json({ message: "Primary Koibito not found" });
    }

    if (!diaryModeEnabled) {
      return res.status(403).json({
        message: "Diary mode is disabled for the primary Koibito",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: false,
      });
    }

    if (String(primaryKoibito.id) !== String(koibito_id)) {
      return res.status(403).json({
        message: "Only the primary Koibito can write POV diary entries",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: true,
      });
    }

    const safeKoibitoName = primaryKoibito.name || koibito_name;

    const result = await pool.query(
      `INSERT INTO koibito_diary_entries (user_id, koibito_id, koibito_name, entry_text, date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, koibito_id, safeKoibitoName, entry_text, date]
    );

    await notify(
      userId,
      "diary_entry",
      "Koibito Diary",
      `${safeKoibitoName} wrote a new diary entry.`,
      {
        koibito_id,
        entry_id: result.rows[0].id,
        primary_koibito_id: primaryKoibito.id,
      }
    );

    res.json({
      success: true,
      message: "Koibito diary entry created",
      primary_koibito: primaryKoibito,
      diary_mode_enabled: true,
      entry: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create koibito diary entry" });
  }
});

// POST /diary/koibito/:entry_id/comment
router.post("/koibito/:entry_id/comment", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const entryId = req.params.entry_id;
  const { koibito_id, koibito_name, comment_text } = req.body;

  if (!comment_text) {
    return res.status(400).json({
      message: "comment_text is required",
    });
  }

  try {
    const { primaryKoibito, diaryModeEnabled } = await getPrimaryKoibitoWithDiaryMode(userId);

    if (!primaryKoibito) {
      return res.status(404).json({ message: "Primary Koibito not found" });
    }

    if (!diaryModeEnabled) {
      return res.status(403).json({
        message: "Diary mode is disabled for the primary Koibito",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: false,
      });
    }

    const entryResult = await pool.query(
      `SELECT id, user_id, koibito_id, koibito_name
       FROM koibito_diary_entries
       WHERE id = $1 AND user_id = $2`,
      [entryId, userId]
    );

    if (entryResult.rows.length === 0) {
      return res.status(404).json({ message: "Koibito diary entry not found" });
    }

    const diaryEntry = entryResult.rows[0];

    if (String(diaryEntry.koibito_id) !== String(primaryKoibito.id)) {
      return res.status(403).json({
        message: "Comments are only allowed on the primary Koibito diary entries",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: true,
      });
    }

    if (isUserCommentPayload(req.body)) {
      const result = await pool.query(
        `INSERT INTO koibito_diary_comments (diary_id, koibito_id, koibito_name, comment_text)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [entryId, null, "You", comment_text]
      );

      await notify(
        userId,
        "diary_comment",
        "Diary Comment",
        `You commented on ${diaryEntry.koibito_name}'s diary entry.`,
        {
          entry_id: entryId,
          diary_id: entryId,
          primary_koibito_id: primaryKoibito.id,
          commenter_type: "user",
        }
      );

      return res.json({
        success: true,
        message: "User diary comment created",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: true,
        comment: {
          ...result.rows[0],
          commenter_type: "user",
        },
      });
    }

    if (!koibito_id || !koibito_name) {
      return res.status(400).json({
        message: "koibito_id and koibito_name are required for Koibito comments",
      });
    }

    const commentingKoibito = await getKoibitoForUser(userId, koibito_id);

    if (!commentingKoibito) {
      return res.status(404).json({ message: "Commenting Koibito not found" });
    }

    const safeCommentingKoibitoName = commentingKoibito.name || koibito_name;

    const commentCountResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM koibito_diary_comments
       WHERE diary_id = $1 AND koibito_id = $2`,
      [entryId, koibito_id]
    );

    if ((commentCountResult.rows[0]?.count || 0) >= MAX_KOIBITO_COMMENTS_PER_ENTRY) {
      return res.json({
        success: true,
        limit_reached: true,
        message: `Each Koibito can only make ${MAX_KOIBITO_COMMENTS_PER_ENTRY} comments/replies on one diary entry`,
      });
    }

    const result = await pool.query(
      `INSERT INTO koibito_diary_comments (diary_id, koibito_id, koibito_name, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [entryId, koibito_id, safeCommentingKoibitoName, comment_text]
    );

    const isPrimaryReply = String(commentingKoibito.id) === String(primaryKoibito.id);
    const notificationText = isPrimaryReply
      ? `${safeCommentingKoibitoName} replied in their diary entry.`
      : `${safeCommentingKoibitoName} commented on ${diaryEntry.koibito_name}'s diary entry.`;

    await notify(
      userId,
      "diary_comment",
      "Diary Comment",
      notificationText,
      {
        entry_id: entryId,
        diary_id: entryId,
        koibito_id,
        primary_koibito_id: primaryKoibito.id,
        commenter_type: "koibito",
      }
    );

    return res.json({
      success: true,
      message: isPrimaryReply
        ? "Primary Koibito diary reply created"
        : "Koibito diary comment created",
      primary_koibito: primaryKoibito,
      diary_mode_enabled: true,
      comment: {
        ...result.rows[0],
        commenter_type: "koibito",
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create koibito diary comment" });
  }
});

// DELETE /diary/koibito/comments/user/:comment_id
router.delete("/koibito/comments/user/:comment_id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const commentId = req.params.comment_id;

  try {
    const deleteResult = await pool.query(
      `DELETE FROM koibito_diary_comments
       WHERE id = $1
         AND diary_id IN (
           SELECT id
           FROM koibito_diary_entries
           WHERE user_id = $2
         )
         AND (koibito_id IS NULL OR koibito_id = 0 OR LOWER(COALESCE(koibito_name, '')) = 'you')
       RETURNING id`,
      [commentId, userId]
    );

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: "User diary comment not found" });
    }

    res.json({
      success: true,
      message: "User diary comment deleted",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete user diary comment" });
  }
});

// GET /diary/koibito
router.get("/koibito", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const { primaryKoibito, diaryModeEnabled } = await getPrimaryKoibitoWithDiaryMode(userId);

    if (!primaryKoibito) {
      return res.status(404).json({ message: "Primary Koibito not found" });
    }

    if (!diaryModeEnabled) {
      return res.json({
        success: true,
        primary_koibito: primaryKoibito,
        diary_mode_enabled: false,
        entries: [],
        comments: [],
      });
    }

    const entriesResult = await pool.query(
      `SELECT id, user_id, koibito_id, koibito_name, entry_text, date, created_at
       FROM koibito_diary_entries
       WHERE user_id = $1 AND koibito_id = $2
       ORDER BY date DESC, created_at DESC`,
      [userId, primaryKoibito.id]
    );

    const commentsResult = await pool.query(
      `SELECT id, diary_id, koibito_id, koibito_name, comment_text, created_at
       FROM koibito_diary_comments
       WHERE diary_id = ANY(
         SELECT id
         FROM koibito_diary_entries
         WHERE user_id = $1 AND koibito_id = $2
       )
       ORDER BY created_at ASC`,
      [userId, primaryKoibito.id]
    );

    res.json({
      success: true,
      primary_koibito: primaryKoibito,
      diary_mode_enabled: true,
      entries: entriesResult.rows,
      comments: commentsResult.rows.map(mapDiaryComment),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibito diary entries" });
  }
});

// GET /diary/koibito/:koibito_id
router.get("/koibito/:koibito_id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.koibito_id;

  try {
    const { primaryKoibito, diaryModeEnabled } = await getPrimaryKoibitoWithDiaryMode(userId);

    if (!primaryKoibito) {
      return res.status(404).json({ message: "Primary Koibito not found" });
    }

    if (String(primaryKoibito.id) !== String(koibitoId)) {
      return res.status(403).json({
        message: "Only the primary Koibito POV diary can be accessed",
        primary_koibito: primaryKoibito,
        diary_mode_enabled: diaryModeEnabled,
      });
    }

    if (!diaryModeEnabled) {
      return res.json({
        success: true,
        primary_koibito: primaryKoibito,
        diary_mode_enabled: false,
        entries: [],
        comments: [],
      });
    }

    const entriesResult = await pool.query(
      `SELECT id, user_id, koibito_id, koibito_name, entry_text, date, created_at
       FROM koibito_diary_entries
       WHERE user_id = $1 AND koibito_id = $2
       ORDER BY date DESC, created_at DESC`,
      [userId, koibitoId]
    );

    const commentsResult = await pool.query(
      `SELECT id, diary_id, koibito_id, koibito_name, comment_text, created_at
       FROM koibito_diary_comments
       WHERE diary_id = ANY(
         SELECT id
         FROM koibito_diary_entries
         WHERE user_id = $1 AND koibito_id = $2
       )
       ORDER BY created_at ASC`,
      [userId, koibitoId]
    );

    res.json({
      success: true,
      primary_koibito: primaryKoibito,
      diary_mode_enabled: true,
      entries: entriesResult.rows,
      comments: commentsResult.rows.map(mapDiaryComment),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch koibito diary detail" });
  }
});

module.exports = router;
