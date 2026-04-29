const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const multer = require("multer");
const path = require("path");
const supabase = require("../lib/supabase");

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

/**
 * Queue owner profile sync to all paired koibitos for this user.
 * Uses existing naming where possible:
 * - avatar stays avatar
 * - public profile route/data stays under user_profiles
 */
async function queueOwnerProfileSync(userId) {
  console.log("=== QUEUE OWNER PROFILE SYNC FIRED ===", userId);

  const profileResult = await pool.query(
    `SELECT
       user_id,
       display_name,
       avatar,
       bio,
       gender,
       birthday,
       COALESCE(profile_visibility, 'public') AS profile_visibility
     FROM user_profiles
     WHERE user_id = $1`,
    [userId]
  );

  const personaResult = await pool.query(
    `SELECT
       user_id,
       persona_name,
       persona_bio,
       persona_gender,
       persona_birthday,
       COALESCE(likes, '[]'::jsonb) AS likes,
       COALESCE(dislikes, '[]'::jsonb) AS dislikes,
       COALESCE(hobbies, '[]'::jsonb) AS hobbies
     FROM user_personas
     WHERE user_id = $1`,
    [userId]
  );

  const settingsResult = await pool.query(
    `SELECT
       COALESCE(hide_profile, false) AS hide_profile,
       COALESCE(allow_profile_share, true) AS allow_profile_share,
       COALESCE(persona_visible_to_koibito, true) AS persona_visible_to_koibito
     FROM user_profile_settings
     WHERE user_id = $1`,
    [userId]
  );

  const profile = profileResult.rows[0] || {};
  const persona = personaResult.rows[0] || {};
  const settings = settingsResult.rows[0] || {};

  const payload = {
    owner_profile: {
      public_profile: {
        display_name: profile.display_name || "",
        avatar: profile.avatar || "",
        bio: profile.bio || "",
        gender: profile.gender || "",
        birthday: profile.birthday || "",
        profile_visibility: profile.profile_visibility || "public",
      },
      persona_profile: {
        persona_name: persona.persona_name || "",
        persona_bio: persona.persona_bio || "",
        persona_gender: persona.persona_gender || "",
        persona_birthday: persona.persona_birthday || "",
        likes: Array.isArray(persona.likes) ? persona.likes : [],
        dislikes: Array.isArray(persona.dislikes) ? persona.dislikes : [],
        hobbies: Array.isArray(persona.hobbies) ? persona.hobbies : [],
      },
      settings: {
        hide_profile: !!settings.hide_profile,
        allow_profile_share:
          settings.allow_profile_share !== undefined
            ? !!settings.allow_profile_share
            : true,
        persona_visible_to_koibito:
          settings.persona_visible_to_koibito !== undefined
            ? !!settings.persona_visible_to_koibito
            : true,
      },
    },
  };

  const devicesResult = await pool.query(
    `SELECT d.device_id
     FROM devices d
     JOIN koibitos k ON k.id = d.koibito_id
     WHERE k.user_id = $1`,
    [userId]
  );

  console.log("=== DEVICES FOUND ===", devicesResult.rows.length);

  for (const row of devicesResult.rows) {
    console.log("=== INSERTING CONFIG PATCH FOR ===", row.device_id);
    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, $2, $3)`,
      [row.device_id, "config_patch", JSON.stringify(payload)]
    );
  }
}

// GET /user/profile
router.get("/profile", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         id,
         user_id,
         display_name,
         avatar,
         bio,
         gender,
         birthday,
         COALESCE(profile_visibility, 'public') AS profile_visibility,
         created_at,
         updated_at
       FROM user_profiles
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      profile: result.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// PATCH /user/profile
router.patch("/profile", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    display_name = "",
    avatar = "",
    bio = "",
    gender = "",
    birthday = null,
    profile_visibility = "public",
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_profiles
       (user_id, display_name, avatar, bio, gender, birthday, profile_visibility, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         avatar = EXCLUDED.avatar,
         bio = EXCLUDED.bio,
         gender = EXCLUDED.gender,
         birthday = EXCLUDED.birthday,
         profile_visibility = EXCLUDED.profile_visibility,
         updated_at = NOW()
       RETURNING
         id,
         user_id,
         display_name,
         avatar,
         bio,
         gender,
         birthday,
         profile_visibility,
         created_at,
         updated_at`,
      [userId, display_name, avatar, bio, gender, birthday, profile_visibility]
    );

    console.log("=== ABOUT TO CALL queueOwnerProfileSync ===", userId);
    await queueOwnerProfileSync(userId);

    res.json({
      success: true,
      message: "Profile updated",
      profile: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// POST /user/profile/avatar
router.post(
  "/profile/avatar",
  authMiddleware,
  avatarUpload.single("file"),
  async (req, res) => {
    const userId = req.user.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "file is required",
      });
    }

    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return res.status(400).json({
        success: false,
        message: "Only image uploads are allowed for avatar",
      });
    }

    try {
      const originalName = file.originalname || "avatar";
      const ext = path.extname(originalName) || ".jpg";
      const safeBaseName = path
        .basename(originalName, ext)
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");

      const finalFileName = `${Date.now()}_${safeBaseName || "avatar"}${ext}`;
      const storagePath = `avatars/${userId}/${finalFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        console.error("Supabase avatar upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload avatar",
          detail: uploadError.message || null,
        });
      }

      const { data: publicUrlData } = supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .getPublicUrl(storagePath);

      const avatarUrl = publicUrlData?.publicUrl || null;

      const result = await pool.query(
        `INSERT INTO user_profiles
         (user_id, avatar, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           avatar = EXCLUDED.avatar,
           updated_at = NOW()
         RETURNING
           id,
           user_id,
           display_name,
           avatar,
           bio,
           gender,
           birthday,
           COALESCE(profile_visibility, 'public') AS profile_visibility,
           created_at,
           updated_at`,
        [userId, avatarUrl]
      );

      await queueOwnerProfileSync(userId);

      return res.json({
        success: true,
        message: "Avatar updated",
        avatar: avatarUrl,
        profile: result.rows[0],
      });
    } catch (err) {
      console.error("POST /user/profile/avatar error:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Failed to update avatar",
      });
    }
  }
);

// PATCH /user/profile/public
router.patch("/profile/public", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    display_name = "",
    avatar = "",
    bio = "",
    gender = "",
    birthday = null,
    profile_visibility = "public",
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_profiles
       (user_id, display_name, avatar, bio, gender, birthday, profile_visibility, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         avatar = EXCLUDED.avatar,
         bio = EXCLUDED.bio,
         gender = EXCLUDED.gender,
         birthday = EXCLUDED.birthday,
         profile_visibility = EXCLUDED.profile_visibility,
         updated_at = NOW()
       RETURNING
         id,
         user_id,
         display_name,
         avatar,
         bio,
         gender,
         birthday,
         profile_visibility,
         created_at,
         updated_at`,
      [userId, display_name, avatar, bio, gender, birthday, profile_visibility]
    );

    await queueOwnerProfileSync(userId);

    res.json({
      success: true,
      message: "Public profile updated",
      profile: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update public profile" });
  }
});

// GET /user/persona
router.get("/persona", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         user_id,
         persona_name,
         persona_bio,
         persona_gender,
         persona_birthday,
         COALESCE(likes, '[]'::jsonb) AS likes,
         COALESCE(dislikes, '[]'::jsonb) AS dislikes,
         COALESCE(hobbies, '[]'::jsonb) AS hobbies,
         created_at,
         updated_at
       FROM user_personas
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      persona: result.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch persona" });
  }
});

// PATCH /user/persona
router.patch("/persona", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    persona_name = "",
    persona_bio = "",
    persona_gender = "",
    persona_birthday = null,
    likes = [],
    dislikes = [],
    hobbies = [],
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_personas
       (user_id, persona_name, persona_bio, persona_gender, persona_birthday, likes, dislikes, hobbies, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         persona_name = EXCLUDED.persona_name,
         persona_bio = EXCLUDED.persona_bio,
         persona_gender = EXCLUDED.persona_gender,
         persona_birthday = EXCLUDED.persona_birthday,
         likes = EXCLUDED.likes,
         dislikes = EXCLUDED.dislikes,
         hobbies = EXCLUDED.hobbies,
         updated_at = NOW()
       RETURNING
         user_id,
         persona_name,
         persona_bio,
         persona_gender,
         persona_birthday,
         likes,
         dislikes,
         hobbies,
         created_at,
         updated_at`,
      [
        userId,
        persona_name,
        persona_bio,
        persona_gender,
        persona_birthday,
        JSON.stringify(Array.isArray(likes) ? likes : []),
        JSON.stringify(Array.isArray(dislikes) ? dislikes : []),
        JSON.stringify(Array.isArray(hobbies) ? hobbies : []),
      ]
    );

    await queueOwnerProfileSync(userId);

    res.json({
      success: true,
      message: "Persona updated",
      persona: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update persona" });
  }
});

// GET /user/profile/settings
router.get("/profile/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         user_id,
         COALESCE(hide_profile, false) AS hide_profile,
         COALESCE(allow_profile_share, true) AS allow_profile_share,
         COALESCE(persona_visible_to_koibito, true) AS persona_visible_to_koibito,
         created_at,
         updated_at
       FROM user_profile_settings
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      settings: result.rows[0] || {
        user_id: userId,
        hide_profile: false,
        allow_profile_share: true,
        persona_visible_to_koibito: true,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch profile settings" });
  }
});

// PATCH /user/profile/settings
router.patch("/profile/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    hide_profile = false,
    allow_profile_share = true,
    persona_visible_to_koibito = true,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO user_profile_settings
       (user_id, hide_profile, allow_profile_share, persona_visible_to_koibito, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         hide_profile = EXCLUDED.hide_profile,
         allow_profile_share = EXCLUDED.allow_profile_share,
         persona_visible_to_koibito = EXCLUDED.persona_visible_to_koibito,
         updated_at = NOW()
       RETURNING
         user_id,
         hide_profile,
         allow_profile_share,
         persona_visible_to_koibito,
         created_at,
         updated_at`,
      [userId, hide_profile, allow_profile_share, persona_visible_to_koibito]
    );

    await queueOwnerProfileSync(userId);

    res.json({
      success: true,
      message: "Profile settings updated",
      settings: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile settings" });
  }
});

// GET /user/:user_id/public
router.get("/:user_id/public", async (req, res) => {
  const { user_id } = req.params;

  try {
    const profileResult = await pool.query(
      `SELECT
         user_id,
         display_name,
         avatar,
         bio,
         gender,
         birthday,
         COALESCE(profile_visibility, 'public') AS profile_visibility
       FROM user_profiles
       WHERE user_id = $1`,
      [user_id]
    );

    const profile = profileResult.rows[0];

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Public profile not found",
      });
    }

    if (profile.profile_visibility === "private") {
      return res.status(403).json({
        success: false,
        message: "This profile is private",
      });
    }

    const settingsResult = await pool.query(
      `SELECT
         COALESCE(hide_profile, false) AS hide_profile
       FROM user_profile_settings
       WHERE user_id = $1`,
      [user_id]
    );

    const settings = settingsResult.rows[0] || { hide_profile: false };

    if (settings.hide_profile) {
      return res.status(403).json({
        success: false,
        message: "This profile is hidden",
      });
    }

    const koibitosResult = await pool.query(
      `SELECT
         id,
         name,
         avatar,
         COALESCE(status, 'offline') AS status,
         COALESCE(battery_percent, 0) AS battery_percent,
         paired_at
       FROM koibitos
       WHERE user_id = $1
       ORDER BY id ASC`,
      [user_id]
    );

    res.json({
      success: true,
      user: profile,
      koibitos: koibitosResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch public profile" });
  }
});

// GET /user/badges
router.get("/badges", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         bd.id,
         bd.badge_key,
         bd.label,
         bd.category,
         bd.description,
         bd.icon,
         ub.unlocked_at
       FROM user_badges ub
       JOIN badge_definitions bd ON bd.id = ub.badge_id
       WHERE ub.user_id = $1
       ORDER BY ub.unlocked_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      badges: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch user badges" });
  }
});

module.exports = router;