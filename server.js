const express = require("express");
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





// Parse JSON FIRST
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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



// Logger
app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/chat", chatRoutes);
app.use("/memories", memoryRoutes);
app.use("/user", userProfileRoutes);
app.use("/koibitos", koibitoRoutes);
app.use("/device", deviceRoutes);
app.use("/", traitRoutes);

// Basic routes
app.get("/", (req, res) => {
  res.send("Koibito backend running");
});

app.get("/profile", authMiddleware, (req, res) => {
  res.json({
    message: "Protected profile data",
    user: req.user
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "koibito-backend" });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});