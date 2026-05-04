const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");

const router = express.Router();
const pool = require("../db");

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

function generateContactCode() {
  return "KBT-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
    },
    "supersecretkey",
    { expiresIn: "7d" }
  );
}

function buildUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    username: user.username,
    contact_code: user.contact_code,
    auth_provider: user.auth_provider || "local",
  };
}

router.post("/register", async (req, res) => {
  const { email, password, full_name, username } = req.body;

  if (!email || !password || !full_name || !username) {
    return res.status(400).json({
      message: "Email, password, full name, and username are required",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const cleanedFullName = full_name.trim();

    const existingUserByEmail = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (existingUserByEmail.rows.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const existingUserByUsername = await pool.query(
      `SELECT id FROM users WHERE username = $1`,
      [normalizedUsername]
    );

    if (existingUserByUsername.rows.length > 0) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const contactCode = generateContactCode();

    const result = await pool.query(
      `INSERT INTO users (
        email,
        password,
        contact_code,
        full_name,
        username,
        auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, contact_code, full_name, username, auth_provider`,
      [
        normalizedEmail,
        hashedPassword,
        contactCode,
        cleanedFullName,
        normalizedUsername,
        "local",
      ]
    );

    res.json({
      message: "User registered",
      user: buildUserResponse(result.rows[0]),
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (!user.password) {
      return res.status(400).json({
        message: "This account uses Google sign-in. Please continue with Google.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = signUserToken(user);

    res.json({
      message: "Login successful",
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/google", async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: "Google ID token required" });
  }

  if (!process.env.GOOGLE_WEB_CLIENT_ID) {
    return res.status(500).json({ message: "Google auth is not configured" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      return res.status(400).json({ message: "Invalid Google token" });
    }

    const googleId = payload.sub;
    const email = payload.email?.trim().toLowerCase();
    const fullName = payload.name?.trim() || null;

    if (!googleId || !email) {
      return res.status(400).json({ message: "Google account data is incomplete" });
    }

    let userResult = await pool.query(
      `SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1`,
      [googleId, email]
    );

    let user;

    if (userResult.rows.length === 0) {
      const contactCode = generateContactCode();

      let baseUsername =
        (email.split("@")[0] || "user")
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "") || "user";

      let username = baseUsername;
      let counter = 1;

      while (true) {
        const existingUsername = await pool.query(
          `SELECT id FROM users WHERE username = $1`,
          [username]
        );

        if (existingUsername.rows.length === 0) {
          break;
        }

        username = `${baseUsername}${counter}`;
        counter += 1;
      }

      const insertResult = await pool.query(
        `INSERT INTO users (
          email,
          password,
          contact_code,
          full_name,
          username,
          auth_provider,
          google_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, email, contact_code, full_name, username, auth_provider, google_id`,
        [email, null, contactCode, fullName, username, "google", googleId]
      );

      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];

      const updatedResult = await pool.query(
        `UPDATE users
        SET
          google_id = COALESCE(google_id, $1),
          full_name = COALESCE(full_name, $2),
          auth_provider = CASE
            WHEN auth_provider = 'local' THEN 'google'
            ELSE auth_provider
          END
        WHERE id = $3
        RETURNING id, email, contact_code, full_name, username, auth_provider, google_id, password`,
        [googleId, fullName, user.id]
      );

      user = updatedResult.rows[0];
    }

    const token = signUserToken(user);

    res.json({
      message: "Google login successful",
      token,
      user: buildUserResponse(user),
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(500).json({ message: "Google authentication failed" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await pool.query(
      `SELECT id, email, auth_provider FROM users WHERE email = $1`,
      [normalizedEmail]
    );

    // Safe response so people can't sniff registered emails
    if (userResult.rows.length === 0) {
      return res.json({
        message: "If that email exists, reset instructions have been sent.",
      });
    }

    const user = userResult.rows[0];

    if (user.auth_provider === "google") {
      return res.status(400).json({
        message: "This account uses Google sign-in. Please continue with Google.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await pool.query(
      `UPDATE users
       SET reset_password_token = $1,
           reset_password_expires = $2
       WHERE id = $3`,
      [hashedToken, expiresAt, user.id]
    );

    const resetLink = `${process.env.APP_URL || "http://localhost:8082"}/reset-password?token=${rawToken}`;

    console.log("PASSWORD RESET LINK:", resetLink);

    res.json({
      message: "If that email exists, reset instructions have been sent.",
      dev_reset_link: resetLink,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;