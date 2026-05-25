const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { syncSoulPacket } = require("../services/soulPacketSync");
const { processEvent } = require("../services/eventProcessor");

function normalizeTraitLabel(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function makeTraitKey(label) {
  return normalizeTraitLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/[\s_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

async function ensureUniqueTraitKey(client, baseKey) {
  const safeBase = baseKey || "custom_trait";

  const existing = await client.query(
    `SELECT trait_key FROM trait_definitions WHERE trait_key = $1`,
    [safeBase]
  );

  if (existing.rows.length === 0) return safeBase;

  let counter = 2;
  while (true) {
    const candidate = `${safeBase}_${counter}`;
    const check = await client.query(
      `SELECT trait_key FROM trait_definitions WHERE trait_key = $1`,
      [candidate]
    );

    if (check.rows.length === 0) return candidate;
    counter += 1;
  }
}

// GET /traits
router.get("/traits", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, trait_key, label, category
       FROM trait_definitions
       WHERE is_active = TRUE
       ORDER BY label ASC`
    );

    res.json({
      success: true,
      traits: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch traits" });
  }
});

// PUT /koibitos/:id/traits
router.put("/koibitos/:id/traits", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const koibitoId = req.params.id;
  const { trait_ids, traits } = req.body;

  const hasTraitIds = Array.isArray(trait_ids);
  const hasTraitLabels = Array.isArray(traits);

  if (!hasTraitIds && !hasTraitLabels) {
    return res.status(400).json({
      message: "Provide either trait_ids array or traits array",
    });
  }

  const client = await pool.connect();

  try {
    const koibitoCheck = await client.query(
      `SELECT id FROM koibitos WHERE id = $1 AND user_id = $2`,
      [koibitoId, userId]
    );

    if (koibitoCheck.rows.length === 0) {
      return res.status(404).json({ message: "Koibito not found" });
    }

    let finalTraitIds = [];

    await client.query("BEGIN");

    if (hasTraitIds) {
      if (trait_ids.length > 12) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Maximum 12 traits allowed" });
      }

      const normalizedIds = [...new Set(trait_ids.map(Number).filter(Number.isFinite))];

      const validTraits = await client.query(
        `SELECT id
         FROM trait_definitions
         WHERE id = ANY($1::int[]) AND is_active = TRUE`,
        [normalizedIds]
      );

      if (validTraits.rows.length !== normalizedIds.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "One or more trait_ids are invalid" });
      }

      finalTraitIds = normalizedIds;
    } else {
      const cleanedTraits = [
        ...new Set(traits.map(normalizeTraitLabel).filter(Boolean)),
      ];

      if (cleanedTraits.length > 12) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Maximum 12 traits allowed" });
      }

      for (const label of cleanedTraits) {
        const existing = await client.query(
          `SELECT id
           FROM trait_definitions
           WHERE LOWER(label) = LOWER($1)
           LIMIT 1`,
          [label]
        );

        if (existing.rows.length > 0) {
          finalTraitIds.push(existing.rows[0].id);
          continue;
        }

        const baseKey = makeTraitKey(label);
        const uniqueKey = await ensureUniqueTraitKey(client, baseKey);

        const inserted = await client.query(
          `INSERT INTO trait_definitions (trait_key, label, category, is_active)
           VALUES ($1, $2, $3, TRUE)
           RETURNING id`,
          [uniqueKey, label, "custom"]
        );

        finalTraitIds.push(inserted.rows[0].id);
      }

      finalTraitIds = [...new Set(finalTraitIds.map(Number).filter(Number.isFinite))];
    }

    await client.query(`DELETE FROM koibito_traits WHERE koibito_id = $1`, [koibitoId]);

    for (const traitId of finalTraitIds) {
      await client.query(
        `INSERT INTO koibito_traits (koibito_id, trait_id)
         VALUES ($1, $2)`,
        [koibitoId, traitId]
      );
    }

    const result = await client.query(
      `SELECT td.id, td.trait_key, td.label, td.category
       FROM koibito_traits kt
       JOIN trait_definitions td ON td.id = kt.trait_id
       WHERE kt.koibito_id = $1
       ORDER BY td.label ASC`,
      [koibitoId]
    );

    await client.query("COMMIT");

    await syncSoulPacket(koibitoId, userId);

    try {
      await processEvent({
        user_id: userId,
        koibito_id: koibitoId,
        event_type: 'koibito.profile_edited',
        source: 'traits',
      });
    } catch(eventErr){
      console.warn('[traits] event processing failed:', eventErr.message);
    }

    res.json({
      success: true,
      message: "Traits updated and Soul Packet synced",
      traits: result.rows,
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error(err);
    res.status(500).json({ message: "Failed to update traits" });
  } finally {
    client.release();
  }
});

module.exports = router;