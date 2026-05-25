const express = require('express');
const router = express.Router();
const pool = require('../db');
const authMiddleware = require("../middleware/authMiddleware");

router.get('/user/badges', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT
        kb.id,
        bd.name as label,
        bd.category
      FROM koibito_badges kb
      JOIN badge_definitions bd
        ON kb.badge_id = bd.id
      WHERE kb.user_id = $1
      ORDER BY kb.unlocked_at DESC
      `,
      [userId]
    );

    return res.json({
      success: true,
      badges: result.rows,
    });

  } catch (err) {
    console.error('badges error:', err);

    return res.status(500).json({
      success:false,
      message:'Failed to load badges'
    });
  }
});

module.exports = router;