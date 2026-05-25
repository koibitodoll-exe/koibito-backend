// backend/services/badgeStore.js

const scoreKeys = [
  'bff',
  'confidante',
  'mentorship',
  'soft_spot',
  'partner_in_crime',
];

const settings = {
  defaultMessageCooldown: 4,
  sessionTotalCap: 12,
};

const dailyCaps = {
  bff: 10,
  confidante: 10,
  mentorship: 10,
  soft_spot: 10,
  partner_in_crime: 10,
};

const automaticQualityPassTriggers = [
  'onboarding_completed',
  'koibito_paired',
  'message_sent',
  'diary_created',
  'game_played',
  'reminder_created',
  'moment_media_uploaded',
  'theme_changed',
  'koibito_profile_edited',
  'all_tabs_opened',
  'badge_count_reached',
  'voice_chat_used',
  'tts_heard',
  'long_message_sent',
  'late_night_open',
  'repeat_chat_open',
  'persona_edited',
  'friend_added',
  'three_day_streak',
];

const scoring = {};

const badges = {
  STARS_ALIGNED: {
    code: 'STARS_ALIGNED',
    owner: 'user',
    rules: { eventType: 'onboarding_completed' },
  },

  YOU_FOUND_ME: {
    code: 'YOU_FOUND_ME',
    owner: 'koibito',
    rules: { eventType: 'koibito_paired' },
  },

  THAT_FIRST_TIME_YOU_SAID: {
    code: 'THAT_FIRST_TIME_YOU_SAID',
    owner: 'koibito',
    rules: { eventType: 'message_sent' },
  },

  DEAR_DIARY: {
    code: 'DEAR_DIARY',
    owner: 'user',
    rules: { eventType: 'diary_created' },
  },

  BUTTON_MASHER: {
    code: 'BUTTON_MASHER',
    owner: 'user',
    rules: { eventType: 'game_played' },
  },

  DO_IT_FOR_THE_PLOT: {
    code: 'DO_IT_FOR_THE_PLOT',
    owner: 'user',
    rules: { eventType: 'reminder_created' },
  },

  EVIDENCE_COLLECTED: {
    code: 'EVIDENCE_COLLECTED',
    owner: 'user',
    rules: { eventType: 'moment_media_uploaded' },
  },

  THEME_DISCOVERY: {
    code: 'THEME_DISCOVERY',
    owner: 'user',
    rules: { eventType: 'theme_changed' },
  },

  CHARACTER_DEVELOPMENT: {
    code: 'CHARACTER_DEVELOPMENT',
    owner: 'koibito',
    rules: { eventType: 'koibito_profile_edited' },
  },

  APP_SCAVENGER: {
    code: 'APP_SCAVENGER',
    owner: 'user',
    rules: {
      eventType: 'app_tab_opened',
      allActionTypes: [
        'app_tab_home_opened',
        'app_tab_chats_opened',
        'app_tab_diary_opened',
        'app_tab_games_opened',
        'app_tab_moments_opened',
        'app_tab_settings_opened',
      ],
    },
  },

  SHINY_THING_ACQUIRED: {
    code: 'SHINY_THING_ACQUIRED',
    owner: 'user',
    rules: {
      eventType: 'badge_count_reached',
      minOwnedBadges: 5,
    },
  },

  BREAKING_THE_SILENCE: {
    code: 'BREAKING_THE_SILENCE',
    owner: 'koibito',
    rules: { eventType: 'voice_chat_used' },
  },

  THAT_THING_TALKED: {
    code: 'THAT_THING_TALKED',
    owner: 'koibito',
    rules: { eventType: 'tts_heard' },
  },

  SUCH_A_WRITER: {
    code: 'SUCH_A_WRITER',
    owner: 'koibito',
    rules: {
      eventType: 'message_sent',
      minTextLength: 250,
    },
  },

  AFTER_HOURS: {
    code: 'AFTER_HOURS',
    owner: 'user',
    rules: { eventType: 'late_night_open' },
  },

  YOU_AGAIN: {
    code: 'YOU_AGAIN',
    owner: 'koibito',
    rules: {
      eventType: 'repeat_chat_open',
      minCount: 3,
      sameKoibito: true,
      sinceDays: 1,
    },
  },

  MIRROR_MIRROR: {
    code: 'MIRROR_MIRROR',
    owner: 'user',
    rules: { eventType: 'persona_edited' },
  },

  NOT_ANTI_SOCIAL: {
    code: 'NOT_ANTI_SOCIAL',
    owner: 'user',
    rules: { eventType: 'friend_added' },
  },

  YOU_MISS_ME: {
    code: 'YOU_MISS_ME',
    owner: 'user',
    rules: {
      eventType: 'app_opened',
      minDistinctDays: 3,
    },
  },
}
module.exports = {
  scoreKeys,
  settings,
  dailyCaps,
  automaticQualityPassTriggers,
  scoring,
  badges,
};