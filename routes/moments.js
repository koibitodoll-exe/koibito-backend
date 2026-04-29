const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const notify = require("../utils/notify");

// GET /moments/feed
router.get("/feed", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, author_id, author_type, text, media_url, link_url, created_at
       FROM moments_posts
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      posts: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch moments feed" });
  }
});

// POST /moments/post
router.post("/post", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    author_type = "user",
    author_id = null,
    text = null,
    media_url = null,
    link_url = null,
  } = req.body;

  try {
    let finalAuthorId = userId;
    let actorName = "You";

    if (author_type === "koibito" && author_id) {
      const koibitoResult = await pool.query(
        `SELECT id, name
         FROM koibitos
         WHERE id = $1 AND user_id = $2`,
        [author_id, userId]
      );

      if (koibitoResult.rows.length === 0) {
        return res.status(404).json({ message: "Koibito not found" });
      }

      finalAuthorId = author_id;
      actorName = koibitoResult.rows[0].name || "Your Koibito";
    }

    const result = await pool.query(
      `INSERT INTO moments_posts (author_id, author_type, text, media_url, link_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [finalAuthorId, author_type, text, media_url, link_url]
    );

    // Notify only when koibito posts, not when user posts
    if (author_type === "koibito") {
      await notify(
        userId,
        "moment_post",
        "New Moment",
        `${actorName} posted a new moment.`,
        {
          moment_id: result.rows[0].id,
          koibito_id: finalAuthorId,
        }
      );
    }

    res.json({
      success: true,
      message: "Moment created",
      post: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create moment" });
  }
});

// POST /moments/:id/like
router.post("/:id/like", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const postId = req.params.id;

  try {
    const postResult = await pool.query(
      `SELECT id, author_id, author_type
       FROM moments_posts
       WHERE id = $1`,
      [postId]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: "Moment not found" });
    }

    const post = postResult.rows[0];

    await pool.query(
      `INSERT INTO moments_likes (post_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
      [postId, userId]
    );

    // figure out actor name
    const actorProfile = await pool.query(
      `SELECT display_name
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );

    const actorName =
      actorProfile.rows[0]?.display_name || "Someone";

    // notify only if not self-like on user-owned post
    if (!(post.author_type === "user" && Number(post.author_id) === Number(userId))) {
      let targetUserId = null;

      if (post.author_type === "user") {
        targetUserId = post.author_id;
      } else if (post.author_type === "koibito") {
        const ownerResult = await pool.query(
          `SELECT user_id
           FROM koibitos
           WHERE id = $1`,
          [post.author_id]
        );
        targetUserId = ownerResult.rows[0]?.user_id || null;
      }

      if (targetUserId) {
        await notify(
          targetUserId,
          "moment_like",
          "Moment Liked",
          `${actorName} liked your moment.`,
          { moment_id: postId }
        );
      }
    }

    res.json({
      success: true,
      message: "Post liked",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to like post" });
  }
});

// POST /moments/:id/comment
router.post("/:id/comment", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const postId = req.params.id;
  const { comment } = req.body;

  if (!comment) {
    return res.status(400).json({ message: "comment is required" });
  }

  try {
    const postResult = await pool.query(
      `SELECT id, author_id, author_type
       FROM moments_posts
       WHERE id = $1`,
      [postId]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: "Moment not found" });
    }

    const post = postResult.rows[0];

    const result = await pool.query(
      `INSERT INTO moments_comments (post_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [postId, userId, comment]
    );

    const actorProfile = await pool.query(
      `SELECT display_name
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );

    const actorName =
      actorProfile.rows[0]?.display_name || "Someone";

    // notify only if not self-comment on user-owned post
    if (!(post.author_type === "user" && Number(post.author_id) === Number(userId))) {
      let targetUserId = null;

      if (post.author_type === "user") {
        targetUserId = post.author_id;
      } else if (post.author_type === "koibito") {
        const ownerResult = await pool.query(
          `SELECT user_id
           FROM koibitos
           WHERE id = $1`,
          [post.author_id]
        );
        targetUserId = ownerResult.rows[0]?.user_id || null;
      }

      if (targetUserId) {
        await notify(
          targetUserId,
          "moment_comment",
          "Moment Comment",
          `${actorName} commented on your moment.`,
          { moment_id: postId, comment_id: result.rows[0].id }
        );
      }
    }

    res.json({
      success: true,
      message: "Comment added",
      comment: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add comment" });
  }
});

module.exports = router;