const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();

require("dotenv").config();

const authRoutes = require("./routes/auth");
const authMiddleware = require("./middleware/authMiddleware");
const koibitoRoutes = require("./routes/koibitos");
const chatRoutes = require("./routes/chat");
const memoryRoutes = require("./routes/memories");
const userProfileRoutes = require("./routes/userProfiles");
const deviceRoutes = require("./routes/device");
const traitRoutes = require("./routes/traits");
const voiceRoutes = require("./routes/voices");
const friendRoutes = require("./routes/friends");
const groupRoutes = require("./routes/groups");
const notificationRoutes = require("./routes/notifications");
const reminderRoutes = require("./routes/reminders");
const diaryRoutes = require("./routes/diary");
const momentsRoutes = require("./routes/moments");
const usageRoutes = require("./routes/usage");
const koibitoChatSessionRoutes = require("./routes/koibitoChatSessions");
const connectionRoutes = require("./routes/connections");
const chatUploadRoutes = require("./routes/chatUpload");
const gameRoutes = require("./routes/games");
const appSettingsRoutes = require("./routes/appSettings");
const accountRoutes = require("./routes/account");
const pairingRoutes = require("./routes/pairing");
const koibitoChatRoutes = require("./routes/koibitoChat");
const userMoodRoutes = require("./routes/userMood");
const eventsRoutes = require('./routes/events');
const { initializeSocket } = require('./services/liveSync');
const syncRoutes = require('./routes/sync');
const badgeRoutes = require('./routes/badges');
const actionLogMiddleware =
require("./middleware/actionLogMiddleware");


// Parse JSON FIRST
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply the action log middleware to all routes
app.use(actionLogMiddleware);

// Debug mode
app.get("/ping", (req, res) => {
  res.json({
    ok: true,
    service: "koibito-backend",
    time: new Date().toISOString(),
  });
});

app.use((req, res, next) => {
  console.log("📩 REQ:", req.method, req.originalUrl);

  if (req.body && Object.keys(req.body).length > 0) {
    console.log("📦 BODY:", JSON.stringify(req.body, null, 2));
  }

  next();
});

// Basic routes
app.get("/", (req, res) => {
  res.send("Koibito backend running");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "koibito-backend" });
});

app.get("/profile", authMiddleware, (req, res) => {
  res.json({
    message: "Protected profile data",
    user: req.user,
  });
});

// Routes
app.use("/voices", voiceRoutes);
app.use("/friends", friendRoutes);
app.use("/groups", groupRoutes);
app.use("/notifications", notificationRoutes);
app.use("/reminders", reminderRoutes);
app.use("/diary", diaryRoutes);
app.use("/moments", momentsRoutes);
app.use("/usage", usageRoutes);
app.use("/koibito-chat", koibitoChatSessionRoutes);
app.use("/connections", connectionRoutes);
app.use("/chat", chatUploadRoutes);
app.use("/games", gameRoutes);
app.use("/app-settings", appSettingsRoutes);
app.use("/account", accountRoutes);
app.use("/pairing", pairingRoutes);
app.use("/chat", koibitoChatRoutes);
app.use("/user", userMoodRoutes);
app.use("/voice-providers", require("./routes/voice-providers"));
app.use(badgeRoutes);

app.use("/auth", authRoutes);
app.use("/chat", chatRoutes);
app.use("/memories", memoryRoutes);
app.use("/user", userProfileRoutes);
app.use("/koibitos", koibitoRoutes);
app.use("/device", deviceRoutes);
app.use("/", traitRoutes);
app.use('/events', eventsRoutes);
app.use('/sync', syncRoutes);
const PORT = process.env.PORT || 3000;

// Socket.IO needs the raw HTTP server wrapper.
// Do not use app.listen() when sockets are enabled.
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
  },
});

initializeSocket(io);

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  const joinRoom = (roomName) => {
    if (!roomName) return;
    socket.join(roomName);
    console.log(`🔗 Socket ${socket.id} joined ${roomName}`);
  };

  const leaveRoom = (roomName) => {
    if (!roomName) return;
    socket.leave(roomName);
    console.log(`🚪 Socket ${socket.id} left ${roomName}`);
  };

  socket.on("join_koibito", ({ koibitoId }) => {
    if (!koibitoId) return;
    joinRoom(`koibito:${koibitoId}`);
  });

  socket.on("leave_koibito", ({ koibitoId }) => {
    if (!koibitoId) return;
    leaveRoom(`koibito:${koibitoId}`);
  });

  socket.on("join_chat_room", ({ roomId }) => {
    if (!roomId) return;
    joinRoom(`chat:room:${roomId}`);
  });

  socket.on("leave_chat_room", ({ roomId }) => {
    if (!roomId) return;
    leaveRoom(`chat:room:${roomId}`);
  });

  socket.on("join_group", ({ groupId }) => {
    if (!groupId) return;
    joinRoom(`group:${groupId}`);
  });

  socket.on("leave_group", ({ groupId }) => {
    if (!groupId) return;
    leaveRoom(`group:${groupId}`);
  });

  socket.on("join_koibito_chat", ({ koibitoId, userId }) => {
    if (!koibitoId || !userId) return;
    joinRoom(`koibito-chat:${koibitoId}:${userId}`);
  });

  socket.on("leave_koibito_chat", ({ koibitoId, userId }) => {
    if (!koibitoId || !userId) return;
    leaveRoom(`koibito-chat:${koibitoId}:${userId}`);
  });

  socket.on("join_session", ({ sessionId }) => {
    if (!sessionId) return;
    joinRoom(`session:${sessionId}`);
  });

  socket.on("leave_session", ({ sessionId }) => {
    if (!sessionId) return;
    leaveRoom(`session:${sessionId}`);
  });

  socket.on("disconnect", () => {
    console.log("🔌 Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});