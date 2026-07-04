const truths = require("../data/truth.json");
const dares = require("../data/dare.json");

module.exports = (bot, rooms, statsStore) => {

  const pickUnusedQuestion = (room, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }

    if (!room.usedQuestions) {
      room.usedQuestions = {};
    }

    const stateKey = pool === truths ? "usedTruth" : "usedDare";
    const legacyKey = pool === truths ? "truth" : "dare";

    if (!Array.isArray(room[stateKey])) {
      room[stateKey] = [];
    }

    if (!Array.isArray(room.usedQuestions[legacyKey])) {
      room.usedQuestions[legacyKey] = [];
    }

    if (room[stateKey].length >= pool.length) {
      room[stateKey] = [];
      room.usedQuestions[legacyKey] = [];
    }

    const availableIndexes = pool
      .map((_, index) => index)
      .filter((index) => !room[stateKey].includes(index));

    if (availableIndexes.length === 0) {
      room[stateKey] = [];
      room.usedQuestions[legacyKey] = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    room[stateKey] = [...room[stateKey], selectedIndex];
    room.usedQuestions[legacyKey] = [...room.usedQuestions[legacyKey], selectedIndex];
    return pool[selectedIndex];
  };

  // =============================================
  // SPIN COMMAND
  // =============================================

  bot.onText(/\/spin/, (msg) => {
    const chatId = msg.chat.id;

    if (!rooms[chatId]) {
      return bot.sendMessage(
        chatId,
        "⚠️ Belum ada room. Ketik /join terlebih dahulu."
      );
    }

    if (!rooms[chatId].started) {
      return bot.sendMessage(
        chatId,
        "⚠️ Game belum dimulai."
      );
    }

    if (rooms[chatId].gameMode !== "tod") {
      return bot.sendMessage(
        chatId,
        "⚠️ Mode game saat ini bukan Truth or Dare."
      );
    }

    const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

    if (!currentPlayer) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
    }

    if (msg.from.id !== currentPlayer.id) {
      return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
    }

    const isTruth = Math.random() < 0.5;
    const pool = isTruth ? truths : dares;
    const question = pickUnusedQuestion(rooms[chatId], pool) || pool[0];
    statsStore?.recordQuestion(isTruth ? "truth" : "dare");

    const mode = isTruth
      ? "❓ TRUTH"
      : "🔥 DARE";

    bot.sendMessage(
      chatId,
      `🎯 Giliran: ${currentPlayer.name}

🎲 Hasil Spin
━━━━━━━━━━━━━━

${mode}

${question}

━━━━━━━━━━━━━━
➡️ Ketik /next untuk pemain berikutnya`
    );
  });

};