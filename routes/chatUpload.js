const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const supabase = require("../lib/supabase");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

function getFileType(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

router.post("/upload", authMiddleware, upload.single("file"), async (req, res) => {
  const userId = parseInt(req.user?.id, 10);
  const roomId = parseInt(req.body?.room_id, 10);
  const file = req.file;

  if (!Number.isInteger(userId)) {
    return res.status(401).json({
      success: false,
      message: "Invalid user session",
    });
  }

  if (!Number.isInteger(roomId)) {
    return res.status(400).json({
      success: false,
      message: "Valid room_id is required",
    });
  }

  if (!file) {
    return res.status(400).json({
      success: false,
      message: "file is required",
    });
  }

  try {
    const participantCheck = await pool.query(
      `
      SELECT 1
      FROM chat_participants
      WHERE room_id = $1
        AND participant_type = 'user'
        AND participant_id = $2
      LIMIT 1
      `,
      [roomId, userId]
    );

    if (participantCheck.rowCount === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this room",
      });
    }

    const originalName = file.originalname || "upload";
    const ext = path.extname(originalName);
    const rawBaseName = path.basename(originalName, ext);

    const safeBaseName = rawBaseName
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");

    const finalFileName = `${Date.now()}_${safeBaseName || "upload"}${ext}`;
    const storagePath = `chat/${roomId}/${userId}/${finalFileName}`;

    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return res.status(500).json({
        success: false,
        message: "Failed to upload file to storage",
        detail: uploadError.message || null,
      });
    }

    const { data: publicUrlData } = supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData?.publicUrl || null;

    const result = await pool.query(
      `
      INSERT INTO chat_attachments (
        room_id,
        message_id,
        sender_user_id,
        storage_path,
        public_url,
        file_type,
        mime_type,
        file_name,
        file_size
      )
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        roomId,
        userId,
        storagePath,
        publicUrl,
        getFileType(file.mimetype),
        file.mimetype,
        originalName,
        file.size,
      ]
    );

    return res.status(200).json({
      success: true,
      attachment: result.rows[0],
    });
  } catch (err) {
    console.error("POST /chat/upload FULL ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Server error while uploading attachment",
      detail: err.detail || null,
      hint: err.hint || null,
      code: err.code || null,
    });
  }
});

module.exports = router;