// backend/services/badgeEventMap.js

module.exports = {
  // Starter / normalized badge events
  'onboarding.completed': 'onboarding_completed',
  onboarding_completed: 'onboarding_completed',

  'koibito.paired': 'koibito_paired',
  koibito_paired: 'koibito_paired',

  'chat.message_sent': 'message_sent',
  message_sent: 'message_sent',

  'diary.entry_created': 'diary_created',
  'diary.created': 'diary_created',
  diary_created: 'diary_created',

  'activity.game_completed': 'game_played',
  'activity.game_started': 'game_played',
  'game.played': 'game_played',
  game_played: 'game_played',

  'reminder.created': 'reminder_created',
  reminder_created: 'reminder_created',

  'activity.moment_posted': 'moment_media_uploaded',
  moment_media_uploaded: 'moment_media_uploaded',

  'settings.theme_changed': 'theme_changed',
  theme_changed: 'theme_changed',

  'koibito.profile_edited': 'koibito_profile_edited',
  koibito_profile_edited: 'koibito_profile_edited',

  'voice.session_completed': 'voice_chat_used',
  voice_chat_used: 'voice_chat_used',

  'voice.tts_heard': 'tts_heard',
  tts_heard: 'tts_heard',

  'chat.long_message': 'long_message_sent',
  long_message_sent: 'long_message_sent',

  'behavior.night_active': 'late_night_open',
  late_night_open: 'late_night_open',

  'behavior.quick_return_detected': 'repeat_chat_open',
  repeat_chat_open: 'repeat_chat_open',

  'user.persona_edited': 'persona_edited',
  persona_edited: 'persona_edited',

  'social.friend_added': 'friend_added',
  friend_added: 'friend_added',

  'app.all_tabs_opened': 'all_tabs_opened',
  all_tabs_opened: 'all_tabs_opened',

  'app.three_day_streak': 'three_day_streak',
  three_day_streak: 'three_day_streak',

  // Backend route CCTV mappings
  'POST /friends/request/:id/accept': 'social.friend_added',
  'POST /moments/post': 'activity.moment_posted',
  'POST /games/lobbies/:id/start': 'activity.game_completed',
  'PATCH /user/persona': 'user.persona_edited',
  'PUT /koibitos/:id/traits': 'koibito.profile_edited',
  'POST /chat/rooms/:id/message': 'chat.message_sent',
  'POST /reminders': 'reminder.created',
  'PATCH /app-settings/preferences': 'settings.theme_changed',
};