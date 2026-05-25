const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { processEvent } = require("../services/eventProcessor");

// GET /games
router.get("/", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, game_key, name, is_active, created_at
       FROM games
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );

    res.json({
      success: true,
      games: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch games" });
  }
});

// POST /games/lobbies
router.post("/lobbies", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { game_id, players = [] } = req.body;

  if (!game_id) {
    return res.status(400).json({ message: "game_id is required" });
  }

  try {
    const gameCheck = await pool.query(
      `SELECT id FROM games WHERE id = $1 AND is_active = TRUE`,
      [game_id]
    );

    if (gameCheck.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    const lobbyResult = await pool.query(
      `INSERT INTO game_lobbies (game_id, created_by_user_id, status)
       VALUES ($1, $2, 'waiting')
       RETURNING *`,
      [game_id, userId]
    );

    const lobby = lobbyResult.rows[0];

    await pool.query(
      `INSERT INTO game_lobby_players (lobby_id, player_type, player_id)
       VALUES ($1, 'user', $2)`,
      [lobby.id, userId]
    );

    for (const player of players) {
      await pool.query(
        `INSERT INTO game_lobby_players (lobby_id, player_type, player_id)
         VALUES ($1, $2, $3)`,
        [lobby.id, player.player_type, player.player_id]
      );
    }

    res.json({
      success: true,
      message: "Game lobby created",
      lobby,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create game lobby" });
  }
});

// GET /games/lobbies/:id
router.get("/lobbies/:id", authMiddleware, async (req, res) => {
  const lobbyId = req.params.id;

  try {
    const lobbyResult = await pool.query(
      `SELECT gl.*, g.game_key, g.name AS game_name
       FROM game_lobbies gl
       JOIN games g ON g.id = gl.game_id
       WHERE gl.id = $1`,
      [lobbyId]
    );

    if (lobbyResult.rows.length === 0) {
      return res.status(404).json({ message: "Lobby not found" });
    }

    const playersResult = await pool.query(
      `SELECT id, lobby_id, player_type, player_id, created_at
       FROM game_lobby_players
       WHERE lobby_id = $1
       ORDER BY id ASC`,
      [lobbyId]
    );

    const invitesResult = await pool.query(
      `SELECT id, lobby_id, inviter_user_id, target_type, target_id, status, created_at
       FROM game_invites
       WHERE lobby_id = $1
       ORDER BY id ASC`,
      [lobbyId]
    );

    res.json({
      success: true,
      lobby: lobbyResult.rows[0],
      players: playersResult.rows,
      invites: invitesResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch lobby" });
  }
});

// POST /games/lobbies/:id/invite
router.post("/lobbies/:id/invite", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const lobbyId = req.params.id;
  const { target_type, target_id } = req.body;

  if (!target_type || !target_id) {
    return res.status(400).json({ message: "target_type and target_id are required" });
  }

  try {
    const lobbyCheck = await pool.query(
      `SELECT id, created_by_user_id FROM game_lobbies WHERE id = $1`,
      [lobbyId]
    );

    if (lobbyCheck.rows.length === 0) {
      return res.status(404).json({ message: "Lobby not found" });
    }

    const lobby = lobbyCheck.rows[0];

    if (Number(lobby.created_by_user_id) !== Number(userId)) {
      return res.status(403).json({ message: "Only lobby owner can invite players" });
    }

    const result = await pool.query(
      `INSERT INTO game_invites (lobby_id, inviter_user_id, target_type, target_id, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [lobbyId, userId, target_type, target_id]
    );

    res.json({
      success: true,
      message: "Game invite sent",
      invite: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send game invite" });
  }
});

// POST /games/lobbies/:id/join
router.post("/lobbies/:id/join", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const lobbyId = req.params.id;

  try {
    const lobbyCheck = await pool.query(
      `SELECT id, status FROM game_lobbies WHERE id = $1`,
      [lobbyId]
    );

    if (lobbyCheck.rows.length === 0) {
      return res.status(404).json({ message: "Lobby not found" });
    }

    if (lobbyCheck.rows[0].status !== "waiting") {
      return res.status(400).json({ message: "Lobby is not accepting joins" });
    }

    await pool.query(
      `INSERT INTO game_lobby_players (lobby_id, player_type, player_id)
       VALUES ($1, 'user', $2)
       ON CONFLICT DO NOTHING`,
      [lobbyId, userId]
    );

    res.json({
      success: true,
      message: "Joined lobby",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to join lobby" });
  }
});

// POST /games/lobbies/:id/start
router.post("/lobbies/:id/start", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const lobbyId = req.params.id;

  try {
    const lobbyCheck = await pool.query(
      `SELECT * FROM game_lobbies
       WHERE id = $1 AND created_by_user_id = $2`,
      [lobbyId, userId]
    );

    if (lobbyCheck.rows.length === 0) {
      return res.status(404).json({ message: "Lobby not found or not owned by you" });
    }

    await pool.query(
      `UPDATE game_lobbies
       SET status = 'started'
       WHERE id = $1`,
      [lobbyId]
    );

    const sessionResult = await pool.query(
      `INSERT INTO game_sessions (lobby_id, state_json, status, updated_at)
       VALUES ($1, '{}'::jsonb, 'active', NOW())
       RETURNING *`,
      [lobbyId]
    );

    try {
      await processEvent({
        user_id: userId,
        koibito_id: null,
        event_type: 'activity.game_completed',
        source: 'games',
      });
    } catch(eventErr){
      console.warn('[games] event processing failed:', eventErr.message);
    }

    res.json({
      success: true,
      message: "Game started",
      session: sessionResult.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to start game" });
  }
});

// GET /games/sessions/:id
router.get("/sessions/:id", authMiddleware, async (req, res) => {
  const sessionId = req.params.id;

  try {
    const sessionResult = await pool.query(
      `SELECT gs.*, gl.game_id, g.game_key, g.name AS game_name
       FROM game_sessions gs
       JOIN game_lobbies gl ON gl.id = gs.lobby_id
       JOIN games g ON g.id = gl.game_id
       WHERE gs.id = $1`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ message: "Game session not found" });
    }

    const playersResult = await pool.query(
      `SELECT glp.id, glp.lobby_id, glp.player_type, glp.player_id, glp.created_at
       FROM game_lobby_players glp
       JOIN game_sessions gs ON gs.lobby_id = glp.lobby_id
       WHERE gs.id = $1
       ORDER BY glp.id ASC`,
      [sessionId]
    );

    res.json({
      success: true,
      session: sessionResult.rows[0],
      players: playersResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch game session" });
  }
});

// POST /games/sessions/:id/move
router.post("/sessions/:id/move", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const sessionId = req.params.id;
  const { move_json } = req.body;

  if (!move_json) {
    return res.status(400).json({ message: "move_json is required" });
  }

  try {
    const sessionResult = await pool.query(
      `SELECT gs.*, gl.id AS lobby_id
       FROM game_sessions gs
       JOIN game_lobbies gl ON gl.id = gs.lobby_id
       WHERE gs.id = $1 AND gs.status = 'active'`,
      [sessionId]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ message: "Active session not found" });
    }

    const session = sessionResult.rows[0];
    const state = session.state_json || {};

    const playerCheck = await pool.query(
      `SELECT *
       FROM game_lobby_players glp
       JOIN game_sessions gs ON gs.lobby_id = glp.lobby_id
       WHERE gs.id = $1
         AND glp.player_type = 'user'
         AND glp.player_id = $2`,
      [sessionId, userId]
    );

    if (playerCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not a human player in this session" });
    }

    if (state.current_turn_type && state.current_turn_type !== "user") {
      return res.status(400).json({ message: "It is not a human player's turn" });
    }

    if (state.current_turn_id && Number(state.current_turn_id) !== Number(userId)) {
      return res.status(400).json({ message: "It is not your turn" });
    }

    const moveResult = await pool.query(
      `INSERT INTO game_moves (session_id, player_type, player_id, move_json)
       VALUES ($1, 'user', $2, $3)
       RETURNING *`,
      [sessionId, userId, move_json]
    );

    const nextState = {
      ...state,
      last_move_by: { player_type: "user", player_id: userId },
      last_move: move_json,
      updated_at: new Date().toISOString()
    };

    await pool.query(
      `UPDATE game_sessions
       SET state_json = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [nextState, sessionId]
    );

    res.json({
      success: true,
      message: "Move submitted",
      move: moveResult.rows[0],
      note: "Koibito auto-moves should only be generated later when current_turn_type is koibito."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to submit move" });
  }
});

// GET /games/sessions/:id/chat
router.get("/sessions/:id/chat", authMiddleware, async (req, res) => {
  const sessionId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT id, session_id, sender_type, sender_id, message_text, created_at
       FROM game_chat_messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({
      success: true,
      messages: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch game chat" });
  }
});

// POST /games/sessions/:id/chat
router.post("/sessions/:id/chat", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const sessionId = req.params.id;
  const { message_text } = req.body;

  if (!message_text) {
    return res.status(400).json({ message: "message_text is required" });
  }

  try {
    const participantCheck = await pool.query(
      `SELECT glp.*
       FROM game_lobby_players glp
       JOIN game_sessions gs ON gs.lobby_id = glp.lobby_id
       WHERE gs.id = $1
         AND glp.player_type = 'user'
         AND glp.player_id = $2`,
      [sessionId, userId]
    );

    if (participantCheck.rows.length === 0) {
      return res.status(403).json({ message: "You are not in this game session" });
    }

    const result = await pool.query(
      `INSERT INTO game_chat_messages (session_id, sender_type, sender_id, message_text)
       VALUES ($1, 'user', $2, $3)
       RETURNING *`,
      [sessionId, userId, message_text]
    );

    res.json({
      success: true,
      message: "Game chat message sent",
      chat_message: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send game chat message" });
  }
});

module.exports = router;