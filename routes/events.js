const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');

const { processEvent } = require('../services/eventProcessor');
const { processEqFromEvent } = require('../services/eqEngine');
const { runRegulator } = require('../services/regulator');
const { runBadgeEngine } = require('../services/badgeEngine');
const { remember } = require('../services/memoryEngine');
const { addIngredient } = require('../services/diaryIngredients');
const { runCloudDiaryIfNeeded } = require('../services/diaryOrchestrator');

const diaryEvents = {
  'chat.meaningful_message': 3,
  'emotion.comfort_detected': 3,
  'emotion.vent_detected': 4,
  'emotion.flirt_detected': 2,
  'emotion.meaningful_moment_detected': 5,
  'activity.game_won': 2,
  'activity.rp_completed': 2,
  'activity.chat_request_approved': 3,
};

// POST /events
router.post('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      koibito_id = null,
      event_type,
      source = 'app',
      metadata = {},
      memory_text = '',
    } = req.body;

    if (!event_type) {
      return res.status(400).json({ error: 'event_type is required' });
    }

    const result = await pool.query(
      `
      INSERT INTO interaction_events
        (user_id, koibito_id, event_type, source, metadata)
      VALUES
        ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [userId, koibito_id, event_type, source, metadata]
    );

    const event = result.rows[0];

    await processEvent(event);
    await processEqFromEvent(event);
    await runRegulator(event);
    await runBadgeEngine(event);

    if (memory_text && koibito_id) {
      await remember({
        userId,
        koibitoId: koibito_id,
        memoryText: memory_text,
        source,
      });
    }

    if (koibito_id && diaryEvents[event_type]) {
      await addIngredient({
        userId,
        koibitoId: koibito_id,
        eventType: event_type,
        content: memory_text || metadata?.summary || event_type,
        importance: diaryEvents[event_type],
        metadata,
      });

      await runCloudDiaryIfNeeded({
        userId,
        koibitoId: koibito_id,
      });
    }

    res.json({
      success: true,
      event,
    });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// GET /events/recent
router.get('/recent', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

    const result = await pool.query(
      `
      SELECT *
      FROM interaction_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [userId, limit]
    );

    res.json({
      success: true,
      events: result.rows,
    });
  } catch (err) {
    console.error('Recent events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

module.exports = router;