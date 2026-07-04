const nhie = require("../data/neverhaveiever.json");

module.exports = (bot, rooms, statsStore) => {

  const pickUnusedQuestion = (room, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }

    if (!room.usedQuestions) {
      room.usedQuestions = {};
    }

    if (!Array.isArray(room.usedNHIE)) {
      room.usedNHIE = [];
    }

    if (!Array.isArray(room.usedQuestions.neverhaveiever)) {
      room.usedQuestions.neverhaveiever = [];
    }

    if (room.usedNHIE.length >= pool.length) {
      room.usedNHIE = [];
      room.usedQuestions.neverhaveiever = [];
    }

    const availableIndexes = pool
      .map((_, index) => index)
      .filter((index) => !room.usedNHIE.includes(index));

    if (availableIndexes.length === 0) {
      room.usedNHIE = [];
      room.usedQuestions.neverhaveiever = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    room.usedNHIE = [...room.usedNHIE, selectedIndex];
    room.usedQuestions.neverhaveiever = [...room.usedQuestions.neverhaveiever, selectedIndex];
    return pool[selectedIndex];
  };

  // =============================================
  // NEVER HAVE I EVER COMMAND
  // =============================================

  bot.onText(/\/neverhaveiever/, (msg) => {
    const chatId = msg.chat.id;

    if (!rooms[chatId] || !rooms[chatId].started) {
      return bot.sendMessage(
        chatId,
        "Game belum dimulai."
      );
    }

    if (rooms[chatId].gameMode !== "neverhaveiever") {
      return bot.sendMessage(
        chatId,
        "⚠️ Mode game saat ini bukan NHIE."
      );
    }

    const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

    if (!currentPlayer) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
    }

    if (msg.from.id !== currentPlayer.id) {
      return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
    }

    const question = pickUnusedQuestion(rooms[chatId], nhie) || nhie[0];
    statsStore?.recordQuestion("neverhaveiever");

    bot.sendMessage(
      chatId,
      `🍻 NEVER HAVE I EVER

    🎯 Giliran:
    ${currentPlayer.name}

    ${question}

    ➡️ Ketik /next untuk lanjut ke pemain berikutnya.`
    );
  });

};