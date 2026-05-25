const pool = require('../db');
const badgeStore = require('./badgeStore');
const { unlockBadge } = require('./badgeUnlockService');

const SCORE_KEYS = badgeStore.scoreKeys || [
  'bff',
  'confidante',
  'mentorship',
  'soft_spot',
  'partner_in_crime',
];

const DEFAULT_MESSAGE_COOLDOWN = badgeStore.settings?.defaultMessageCooldown || 4;
const SESSION_TOTAL_CAP = badgeStore.settings?.sessionTotalCap || 12;
const DAILY_CAPS = badgeStore.dailyCaps || {};

const recentTriggerMemory = new Map();

function normalizeEvent(event = {}) {
  const metadata = event.metadata || {};

  return {
    ...event,
    user_id: event.user_id || event.userId,
    koibito_id: event.koibito_id || event.koibitoId || metadata.koibito_id || metadata.koibitoId || null,
    session_id: event.session_id || event.sessionId || metadata.session_id || metadata.sessionId || null,
    event_type: event.event_type || event.eventType || event.type,
    trigger_key:
      event.trigger_key ||
      event.triggerKey ||
      event.trigger ||
      event.event_type ||
      event.eventType ||
      event.type,
    source: event.source || metadata.source || 'unknown',
    text:
      event.text ||
      event.message ||
      event.content ||
      metadata.text ||
      metadata.message ||
      '',
    message_index: Number(event.message_index || event.messageIndex || event.sequence || metadata.message_index || metadata.messageIndex || 0),
    counters: event.counters || metadata.counters || {},
    metadata,
  };
}

function normalizeIntent(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isDuplicateIntent(previousText, nextText) {
  const prev = normalizeIntent(previousText);
  const next = normalizeIntent(nextText);

  if (!prev || !next) return false;
  if (prev === next) return true;

  return prev.includes(next) || next.includes(prev);
}

function makeCooldownKey(event) {
  return [
    event.user_id,
    event.koibito_id || 'user-only',
    event.session_id || 'no-session',
    event.trigger_key,
  ].join(':');
}

function passesQualityGate(event) {
  const automaticEvents = new Set(badgeStore.automaticQualityPassTriggers || []);

  if (automaticEvents.has(event.trigger_key) || automaticEvents.has(event.event_type)) {
    return { passed: true };
  }

  const text = String(event.text || '').trim();

  if (!text) {
    return { passed: true };
  }

  const compact = text.toLowerCase().replace(/[^a-z0-9]+/gi, '');
  const words = text.split(/\s+/).filter(Boolean);

  if (compact.length < 3) {
    return { passed: false, reason: 'too_short' };
  }

  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));

  if (words.length >= 4 && uniqueWords.size <= 1) {
    return { passed: false, reason: 'repeated_same_word' };
  }

  if (/^(hi|hey|lol|haha|hehe){3,}$/i.test(compact)) {
    return { passed: false, reason: 'spammy_repetition' };
  }

  return { passed: true };
}

function passesTriggerCooldown(event, options = {}) {
  const cooldownMessages = options.cooldownMessages || DEFAULT_MESSAGE_COOLDOWN;

  if (!event.trigger_key) {
    return { passed: true };
  }

  const key = makeCooldownKey(event);
  const previous = recentTriggerMemory.get(key);
  const messageIndex = Number(event.message_index || 0);

  if (previous) {
    const distance = messageIndex - Number(previous.messageIndex || 0);

    if (messageIndex && distance >= 0 && distance < cooldownMessages) {
      return { passed: false, reason: 'same_trigger_message_cooldown' };
    }

    if (isDuplicateIntent(previous.text, event.text)) {
      return { passed: false, reason: 'duplicate_intent' };
    }
  }

  recentTriggerMemory.set(key, {
    messageIndex,
    text: event.text || '',
    at: Date.now(),
  });

  return { passed: true };
}

function getTriggerScores(event) {
  return badgeStore.scoring?.[event.trigger_key] || badgeStore.scoring?.[event.event_type] || {};
}

function hasAnyScore(scores = {}) {
  return SCORE_KEYS.some((key) => Number(scores[key] || 0) > 0);
}

function getBadgeOwner(badge = {}) {
  return badge.owner || badge.owner_type || badge.scope || 'koibito';
}

async function ensureRelationshipScore(userId, koibitoId) {
  if (!userId || !koibitoId) return null;

  const result = await pool.query(
    `
    INSERT INTO relationship_scores (user_id, koibito_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, koibito_id)
    DO UPDATE SET updated_at = relationship_scores.updated_at
    RETURNING *
    `,
    [userId, koibitoId]
  );

  return result.rows[0];
}

async function ensureDailyCaps(userId, koibitoId) {
  if (!userId || !koibitoId) return null;

  const result = await pool.query(
    `
    INSERT INTO badge_daily_score_caps (user_id, koibito_id, score_date)
    VALUES ($1, $2, CURRENT_DATE)
    ON CONFLICT (user_id, koibito_id, score_date)
    DO UPDATE SET updated_at = badge_daily_score_caps.updated_at
    RETURNING *
    `,
    [userId, koibitoId]
  );

  return result.rows[0];
}

async function ensureSessionScore(userId, koibitoId, sessionId) {
  if (!userId || !koibitoId || !sessionId) {
    return { total_points: 0 };
  }

  const result = await pool.query(
    `
    INSERT INTO badge_session_scores (user_id, koibito_id, session_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, koibito_id, session_id)
    DO UPDATE SET updated_at = badge_session_scores.updated_at
    RETURNING *
    `,
    [userId, koibitoId, sessionId]
  );

  return result.rows[0];
}

async function incrementSessionCountIfNeeded(userId, koibitoId, sessionId) {
  if (!userId || !koibitoId || !sessionId) return;

  await pool.query(
    `
    UPDATE relationship_scores
    SET
      session_count = CASE
        WHEN last_session_id IS DISTINCT FROM $3 THEN session_count + 1
        ELSE session_count
      END,
      last_session_id = $3,
      updated_at = NOW()
    WHERE user_id = $1 AND koibito_id = $2
    `,
    [userId, koibitoId, sessionId]
  );
}

function applyCaps(triggerScores, dailyCaps, sessionScore) {
  const applied = {};
  let sessionRemaining = SESSION_TOTAL_CAP - Number(sessionScore?.total_points || 0);

  if (sessionRemaining <= 0) {
    return applied;
  }

  for (const key of SCORE_KEYS) {
    const requested = Number(triggerScores[key] || 0);
    if (!requested) continue;

    const usedToday = Number(dailyCaps?.[key] || 0);
    const dailyCap = Number(DAILY_CAPS[key] || 0);
    const dailyRemaining = dailyCap > 0 ? Math.max(0, dailyCap - usedToday) : requested;
    const allowed = Math.min(requested, dailyRemaining, sessionRemaining);

    if (allowed > 0) {
      applied[key] = allowed;
      sessionRemaining -= allowed;
    }
  }

  return applied;
}

async function applyScores(userId, koibitoId, sessionId, appliedScores) {
  if (!userId || !koibitoId) return null;

  const values = SCORE_KEYS.map((key) => Number(appliedScores[key] || 0));
  const totalAdd = values.reduce((sum, value) => sum + value, 0);

  if (totalAdd <= 0) {
    return null;
  }

  const scoreResult = await pool.query(
    `
    UPDATE relationship_scores
    SET
      bff = LEAST(100, bff + $3),
      confidante = LEAST(100, confidante + $4),
      mentorship = LEAST(100, mentorship + $5),
      soft_spot = LEAST(100, soft_spot + $6),
      partner_in_crime = LEAST(100, partner_in_crime + $7),
      total_score = LEAST(500, total_score + $8),
      last_event_at = NOW(),
      updated_at = NOW()
    WHERE user_id = $1 AND koibito_id = $2
    RETURNING *
    `,
    [userId, koibitoId, ...values, totalAdd]
  );

  await pool.query(
    `
    UPDATE badge_daily_score_caps
    SET
      bff = bff + $3,
      confidante = confidante + $4,
      mentorship = mentorship + $5,
      soft_spot = soft_spot + $6,
      partner_in_crime = partner_in_crime + $7,
      updated_at = NOW()
    WHERE user_id = $1 AND koibito_id = $2 AND score_date = CURRENT_DATE
    `,
    [userId, koibitoId, ...values]
  );

  if (sessionId) {
    await pool.query(
      `
      UPDATE badge_session_scores
      SET total_points = total_points + $4,
          updated_at = NOW()
      WHERE user_id = $1 AND koibito_id = $2 AND session_id = $3
      `,
      [userId, koibitoId, sessionId, totalAdd]
    );
  }

  return scoreResult.rows[0] || null;
}

async function logBadgeEvent(event, status = {}) {
  await pool.query(
    `
    INSERT INTO badge_events (
      user_id,
      koibito_id,
      session_id,
      event_type,
      trigger_key,
      source,
      quality_passed,
      duplicate_blocked,
      cooldown_blocked,
      points_applied,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    `,
    [
      event.user_id,
      event.koibito_id || null,
      event.session_id || null,
      event.event_type,
      event.trigger_key || event.event_type,
      event.source || 'unknown',
      status.qualityPassed !== false,
      !!status.duplicateBlocked,
      !!status.cooldownBlocked,
      JSON.stringify(status.pointsApplied || {}),
      JSON.stringify({
        ...(event.metadata || {}),
        ...(status.metadata || {}),
      }),
    ]
  );
}

function scoresFromRow(row = {}) {
  const scores = {};

  for (const key of SCORE_KEYS) {
    scores[key] = Number(row?.[key] || 0);
  }

  return scores;
}

function getShares(scores) {
  const total = Object.values(scores).reduce((sum, value) => sum + Number(value || 0), 0);

  if (total <= 0) {
    return {
      total: 0,
      shares: Object.fromEntries(SCORE_KEYS.map((key) => [key, 0])),
    };
  }

  return {
    total,
    shares: Object.fromEntries(
      SCORE_KEYS.map((key) => [key, Number(scores[key] || 0) / total])
    ),
  };
}

function meetsRule(rule = {}, scoreRow = {}, event = {}) {
  const scores = scoresFromRow(scoreRow);
  const { total, shares } = getShares(scores);
  const sessions = Number(scoreRow?.session_count || 0);
  const counters = event.counters || event.metadata?.counters || {};

  if (rule.minTotalScore && total < rule.minTotalScore) return false;
  if (rule.minSessions && sessions < rule.minSessions) return false;

  if (rule.scoreKey) {
    const share = shares[rule.scoreKey] || 0;
    if (rule.minShare && share < rule.minShare) return false;
  }

  if (rule.scoreKeys && rule.minShareEach) {
    const hasAllShares = rule.scoreKeys.every((key) => (shares[key] || 0) >= rule.minShareEach);
    if (!hasAllShares) return false;
  }

  if (rule.maxShareAny) {
    const maxShare = Math.max(...Object.values(shares));
    if (maxShare > rule.maxShareAny) return false;
  }

  if (rule.counters) {
    for (const [counterKey, minValue] of Object.entries(rule.counters)) {
      if (Number(counters[counterKey] || 0) < Number(minValue)) return false;
    }
  }

  if (rule.eventType && event.event_type !== rule.eventType) return false;
  if (rule.triggerKey && event.trigger_key !== rule.triggerKey) return false;

  return true;
}

function evaluateBadges(scoreRow, event) {
  const eligible = [];
  const badges = badgeStore.badges || {};

  for (const badge of Object.values(badges)) {
    if (!badge?.rules || !badge?.code) continue;

    if (meetsRule(badge.rules, scoreRow, event)) {
      eligible.push(badge.code);
    }
  }

  return eligible;
}

function getBadgeConfigByCode(badgeCode) {
  const badges = badgeStore.badges || {};
  return Object.values(badges).find((badge) => badge?.code === badgeCode) || null;
}

async function process(event = {}) {
  const normalizedEvent = normalizeEvent(event);

  if (!normalizedEvent.user_id || !normalizedEvent.event_type) {
    return {
      success: false,
      skipped: true,
      reason: 'missing_required_event_fields',
    };
  }

  const triggerScores = getTriggerScores(normalizedEvent);
  const hasRelationshipTarget = !!normalizedEvent.koibito_id;
  const shouldTouchRelationshipTables = hasRelationshipTarget && hasAnyScore(triggerScores);

  let scoreRow = null;
  let dailyCaps = null;
  let sessionScore = { total_points: 0 };

  if (hasRelationshipTarget) {
    scoreRow = await ensureRelationshipScore(normalizedEvent.user_id, normalizedEvent.koibito_id);

    if (shouldTouchRelationshipTables) {
      dailyCaps = await ensureDailyCaps(normalizedEvent.user_id, normalizedEvent.koibito_id);
      sessionScore = await ensureSessionScore(
        normalizedEvent.user_id,
        normalizedEvent.koibito_id,
        normalizedEvent.session_id
      );
      await incrementSessionCountIfNeeded(
        normalizedEvent.user_id,
        normalizedEvent.koibito_id,
        normalizedEvent.session_id
      );
    }
  }

  const quality = passesQualityGate(normalizedEvent);

  if (!quality.passed) {
    await logBadgeEvent(normalizedEvent, {
      qualityPassed: false,
      metadata: { reason: quality.reason },
    });

    return {
      success: true,
      skipped: true,
      reason: quality.reason,
    };
  }

  const cooldown = passesTriggerCooldown(normalizedEvent);

  if (!cooldown.passed) {
    await logBadgeEvent(normalizedEvent, {
      cooldownBlocked: true,
      duplicateBlocked: cooldown.reason === 'duplicate_intent',
      metadata: { reason: cooldown.reason },
    });

    return {
      success: true,
      skipped: true,
      reason: cooldown.reason,
    };
  }

  const appliedScores = shouldTouchRelationshipTables
    ? applyCaps(triggerScores, dailyCaps, sessionScore)
    : {};

  const updatedScoreRow = shouldTouchRelationshipTables
    ? await applyScores(
        normalizedEvent.user_id,
        normalizedEvent.koibito_id,
        normalizedEvent.session_id,
        appliedScores
      )
    : null;

  await logBadgeEvent(normalizedEvent, {
    pointsApplied: appliedScores,
    metadata: { triggerScores },
  });

  scoreRow = updatedScoreRow || scoreRow || {};

  const eligibleBadgeCodes = evaluateBadges(scoreRow, normalizedEvent);
  const unlocked = [];
  const skippedUnlocks = [];

  for (const badgeCode of eligibleBadgeCodes) {
    const badgeConfig = getBadgeConfigByCode(badgeCode);
    const owner = getBadgeOwner(badgeConfig);

    if (owner !== 'user' && !normalizedEvent.koibito_id) {
      skippedUnlocks.push({ badgeCode, reason: 'missing_koibito_id_for_koibito_badge' });
      continue;
    }

    const result = await unlockBadge(
      normalizedEvent.user_id,
      normalizedEvent.koibito_id,
      badgeCode,
      owner
    );

    if (result?.unlocked) {
      unlocked.push(result.badge);
    }
  }

  return {
    success: true,
    skipped: false,
    appliedScores,
    eligibleBadgeCodes,
    unlocked,
    skippedUnlocks,
  };
}

module.exports = {
  process,
  evaluateBadges,
  normalizeEvent,
  getTriggerScores,
  DAILY_CAPS,
  SESSION_TOTAL_CAP,
};
