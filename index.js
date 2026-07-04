const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, ".env") });
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const rooms = {};
const statsFilePath = path.join(__dirname, "data", "stats.json");

const defaultStats = {
  users: [],
  groups: [],
  totalGames: 0,
  totalTruth: 0,
  totalDare: 0,
  totalNeverHaveIEver: 0,
  totalWouldYouRather: 0,
  totalQuiz: 0,
  gameModes: {
    truthdare: 0,
    neverhaveiever: 0,
    wouldyourather: 0,
    quiz: 0,
  },
};

const readStats = () => {
  if (!fs.existsSync(statsFilePath)) {
    fs.writeFileSync(statsFilePath, JSON.stringify(defaultStats, null, 2));
    return { ...defaultStats, gameModes: { ...defaultStats.gameModes } };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statsFilePath, "utf8")) || {};
    return {
      ...defaultStats,
      ...parsed,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      gameModes: {
        ...defaultStats.gameModes,
        ...(parsed.gameModes || {}),
      },
    };
  } catch (error) {
    console.warn("Stats file could not be read, resetting:", error.message || error);
    fs.writeFileSync(statsFilePath, JSON.stringify(defaultStats, null, 2));
    return { ...defaultStats, gameModes: { ...defaultStats.gameModes } };
  }
};

const saveStats = (stats) => {
  const normalized = {
    ...defaultStats,
    ...stats,
    users: Array.isArray(stats?.users) ? stats.users : [],
    groups: Array.isArray(stats?.groups) ? stats.groups : [],
    gameModes: {
      ...defaultStats.gameModes,
      ...(stats?.gameModes || {}),
    },
  };

  fs.writeFileSync(statsFilePath, JSON.stringify(normalized, null, 2));
  return normalized;
};

const statsStore = {
  get: () => readStats(),
  save: (stats) => saveStats(stats),
  ensureUser: (userId) => {
    const normalizedId = userId != null ? String(userId) : null;
    if (!normalizedId) {
      return readStats();
    }

    const stats = readStats();
    if (!stats.users.includes(normalizedId)) {
      stats.users.push(normalizedId);
      saveStats(stats);
    }

    return readStats();
  },
  ensureGroup: (chatId) => {
    const normalizedId = chatId != null ? String(chatId) : null;
    if (!normalizedId) {
      return readStats();
    }

    const stats = readStats();
    if (!stats.groups.includes(normalizedId)) {
      stats.groups.push(normalizedId);
      saveStats(stats);
    }

    return readStats();
  },
  recordGameStart: (mode) => {
    const stats = readStats();
    stats.totalGames = Number(stats.totalGames || 0) + 1;

    if (mode === "tod" || mode === "truthdare") {
      stats.gameModes.truthdare = Number(stats.gameModes.truthdare || 0) + 1;
    } else if (mode === "neverhaveiever") {
      stats.gameModes.neverhaveiever = Number(stats.gameModes.neverhaveiever || 0) + 1;
    } else if (mode === "wouldyourather") {
      stats.gameModes.wouldyourather = Number(stats.gameModes.wouldyourather || 0) + 1;
    } else if (mode === "quiz") {
      stats.gameModes.quiz = Number(stats.gameModes.quiz || 0) + 1;
    }

    saveStats(stats);
    return readStats();
  },
  recordQuestion: (mode) => {
    const stats = readStats();

    if (mode === "truth") {
      stats.totalTruth = Number(stats.totalTruth || 0) + 1;
    } else if (mode === "dare") {
      stats.totalDare = Number(stats.totalDare || 0) + 1;
    } else if (mode === "neverhaveiever") {
      stats.totalNeverHaveIEver = Number(stats.totalNeverHaveIEver || 0) + 1;
    } else if (mode === "wouldyourather") {
      stats.totalWouldYouRather = Number(stats.totalWouldYouRather || 0) + 1;
    } else if (mode === "quiz") {
      stats.totalQuiz = Number(stats.totalQuiz || 0) + 1;
    }

    saveStats(stats);
    return readStats();
  },
};

require("./commands/core")(bot, rooms, statsStore);

require("./commands/tod")(bot, rooms, statsStore);
require("./commands/neverhaveiever")(bot, rooms, statsStore);
require("./commands/wouldyourather")(bot, rooms, statsStore);
require("./commands/quiz")(bot, rooms, statsStore);

console.log("🤖 Bot aktif...");
setInterval(() => {}, 1000);