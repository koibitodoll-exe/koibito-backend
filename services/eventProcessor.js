const pool = require('../db');
const badgeEngine = require('./badgeEngine');

const BADGE_EVENT_TYPE_MAP = require('./badgeEventMap');

/*
  // Starter / first-time app events
  'onboarding.completed': 'onboarding_completed',
  'onboarding_completed': 'onboarding_completed',

  'koibito.paired': 'koibito_paired',
  'koibito_paired': 'koibito_paired',

  'chat.message_sent': 'message_sent',
  'message_sent': 'message_sent',

  'diary.entry_created': 'diary_created',
  'diary.created': 'diary_created',
  'diary_created': 'diary_created',

  'activity.game_completed': 'game_played',
  'game.played': 'game_played',
  'game_played': 'game_played',

  'reminder.created': 'reminder_created',
  'reminder_created': 'reminder_created',

  'activity.moment_media_uploaded': 'moment_media_uploaded',
  'moments.media_uploaded': 'moment_media_uploaded',
  'moment_media_uploaded': 'moment_media_uploaded',

  'settings.theme_changed': 'theme_changed',
  'theme.changed': 'theme_changed',
  'theme_changed': 'theme_changed',

  'koibito.profile_edited': 'koibito_profile_edited',
  'koibito_profile_edited': 'koibito_profile_edited',

  'app.all_tabs_opened': 'all_tabs_opened',
  'all_tabs_opened': 'all_tabs_opened',

  'badge.count_reached': 'badge_count_reached',
  'badge_count_reached': 'badge_count_reached',

  'voice.session_completed': 'voice_chat_used',
  'voice.chat_used': 'voice_chat_used',
  'voice_chat_used': 'voice_chat_used',

  'voice.tts_heard': 'tts_heard',
  'voice.tts_played': 'tts_heard',
  'tts_heard': 'tts_heard',

  'chat.long_message': 'long_message_sent',
  'long_message_sent': 'long_message_sent',

  'app.late_night_open': 'late_night_open',
  'behavior.night_active': 'late_night_open',
  'chat.late_night': 'late_night_open',
  'late_night_open': 'late_night_open',

  'chat.repeat_open': 'repeat_chat_open',
  'behavior.repeat_chat_open': 'repeat_chat_open',
  'repeat_chat_open': 'repeat_chat_open',

  'user.persona_edited': 'persona_edited',
  'persona_edited': 'persona_edited',

  'contacts.friend_added': 'friend_added',
  'friend.added': 'friend_added',
  'friend_added': 'friend_added',

  'app.three_day_streak': 'three_day_streak',
  'three_day_streak': 'three_day_streak',
}; */

function normalizeEvent(event = {}) {
  return {
    ...event,
    user_id: event.user_id || event.userId,
    koibito_id: event.koibito_id || event.koibitoId || null,
    session_id: event.session_id || event.sessionId || null,
    event_type: event.event_type || event.eventType || event.type,
    source: event.source || 'event_processor',
    metadata: event.metadata || {},
    text:
      event.text ||
      event.message ||
      event.content ||
      event.metadata?.text ||
      event.metadata?.message ||
      '',
    message_index: event.message_index || event.messageIndex || event.sequence || 0,
  };
}

function getBadgeEventType(eventType, metadata = {}) {
  if (!eventType) return null;

  // Moment badge is only for image/media uploads on Moments.
  // If a generic moment_posted event arrives without media info, skip the badge.
  if (eventType === 'activity.moment_posted') {
    const hasMedia =
      metadata.has_media ||
      metadata.hasMedia ||
      metadata.media_uploaded ||
      metadata.mediaUploaded ||
      metadata.file_type ||
      metadata.fileType ||
      metadata.media_url ||
      metadata.mediaUrl;

    return hasMedia ? 'moment_media_uploaded' : null;
  }

  return BADGE_EVENT_TYPE_MAP[eventType] || null;
}

async function ensureStats(userId, koibitoId) {
  if (!userId || !koibitoId) return;

  await pool.query(
    `
    INSERT INTO user_koibito_stats (user_id, koibito_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, koibito_id) DO NOTHING
    `,
    [userId, koibitoId]
  );
}

async function incrementStat(userId, koibitoId, field, amount = 1) {
  if (!userId || !koibitoId || !field) return;

  await ensureStats(userId, koibitoId);

  await pool.query(
    `
    UPDATE user_koibito_stats
    SET ${field} = COALESCE(${field}, 0) + $3,
        updated_at = NOW()
    WHERE user_id = $1 AND koibito_id = $2
    `,
    [userId, koibitoId, amount]
  );
}

async function processStats(event) {
  const { user_id, koibito_id, event_type, metadata = {} } = event;

  // Stats are per user + Koibito, so user-only app events safely skip this part.
  if (!user_id || !koibito_id || !event_type) return;

  switch (event_type) {
    case 'chat.message_sent':
      return incrementStat(user_id, koibito_id, 'messages_sent');

    case 'chat.message_received':
      return incrementStat(user_id, koibito_id, 'messages_received');

    case 'chat.session_duration_recorded':
      return incrementStat(
        user_id,
        koibito_id,
        'chat_minutes',
        Math.round((metadata.duration_seconds || 0) / 60)
      );

    case 'chat.long_session':
      return incrementStat(user_id, koibito_id, 'long_sessions');

    case 'chat.late_night':
      return incrementStat(user_id, koibito_id, 'late_night_sessions');

    case 'chat.meaningful_message':
      return incrementStat(user_id, koibito_id, 'meaningful_messages');

    case 'voice.session_completed':
      return incrementStat(user_id, koibito_id, 'voice_sessions');

    case 'voice.session_duration_recorded':
      return incrementStat(
        user_id,
        koibito_id,
        'voice_minutes',
        Math.round((metadata.duration_seconds || 0) / 60)
      );

    case 'emotion.comfort_detected':
      return incrementStat(user_id, koibito_id, 'comfort_count');

    case 'emotion.vent_detected':
      return incrementStat(user_id, koibito_id, 'vent_count');

    case 'emotion.flirt_detected':
      return incrementStat(user_id, koibito_id, 'flirt_count');

    case 'activity.game_completed':
      return incrementStat(user_id, koibito_id, 'games_played');

    case 'activity.game_won':
      return incrementStat(user_id, koibito_id, 'games_won');

    case 'activity.game_lost':
      return incrementStat(user_id, koibito_id, 'games_lost');

    case 'activity.rp_completed':
      return incrementStat(user_id, koibito_id, 'rp_sessions');

    case 'activity.moment_posted':
      return incrementStat(user_id, koibito_id, 'moments_posted');

    case 'behavior.koibito_opened':
      return incrementStat(user_id, koibito_id, 'koibito_opens');

    case 'behavior.quick_return_detected':
      return incrementStat(user_id, koibito_id, 'quick_returns');

    case 'behavior.night_active':
      return incrementStat(user_id, koibito_id, 'night_activity_count');

    default:
      return;
  }
}

async function processBadge(event) {
  const badgeEventType = getBadgeEventType(event.event_type, event.metadata);

  if (!event.user_id || !badgeEventType) {
    return null;
  }

  try {
    return await badgeEngine.process({
      user_id: event.user_id,
      koibito_id: event.koibito_id || null,
      session_id: event.session_id || null,
      event_type: badgeEventType,
      trigger_key: badgeEventType,
      source: event.source || 'event_processor',
      text: event.text || '',
      message_index: event.message_index || 0,
      metadata: {
        ...(event.metadata || {}),
        original_event_type: event.event_type,
      },
    });
  } catch (error) {
    console.error('[eventProcessor] badgeEngine failed:', error);
    return {
      success: false,
      skipped: true,
      reason: 'badge_engine_failed',
      error: error.message,
    };
  }
}

async function processEvent(event = {}) {
  const normalizedEvent = normalizeEvent(event);

  if (!normalizedEvent.user_id || !normalizedEvent.event_type) {
    return {
      success: false,
      skipped: true,
      reason: 'missing_required_event_fields',
    };
  }

  await processStats(normalizedEvent);
  const badgeResult = await processBadge(normalizedEvent);

  return {
    success: true,
    skipped: false,
    event_type: normalizedEvent.event_type,
    badgeResult,
  };
}

module.exports = {
  processEvent,
  processStats,
  processBadge,
  normalizeEvent,
  getBadgeEventType,
  BADGE_EVENT_TYPE_MAP,
};
