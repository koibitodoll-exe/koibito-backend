const express = require("express");
const router = express.Router();
const db = require("../database");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/", authMiddleware, (req, res) => {
  const { koibito_id, memory_text } = req.body;
  const userId = req.user.id;

  db.run(
    "INSERT INTO memories (koibito_id, user_id, memory_text) VALUES (?, ?, ?)",
    [koibito_id, userId, memory_text],
    function (err) {
      if (err) {
        return res.status(500).json({ message: "Failed to save memory" });
      }

      res.json({
        message: "Memory saved",
        memory_id: this.lastID
      });
    }
  );
});

router.get("/:koibito_id", authMiddleware, (req, res) => {
  const koibitoId = req.params.koibito_id;
  const userId = req.user.id;

  db.all(
    "SELECT * FROM memories WHERE koibito_id = ? AND user_id = ? ORDER BY created_at DESC",
    [koibitoId, userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: "Failed to fetch memories" });
      }

      res.json({ memories: rows });
    }
  );
});

module.exports = router;