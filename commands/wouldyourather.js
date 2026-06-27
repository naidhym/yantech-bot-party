const questions = require("../data/wouldyourather.json");

module.exports = (bot, rooms) => {

  const pickUnusedQuestion = (room, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }

    if (!room.usedQuestions) {
      room.usedQuestions = {};
    }

    if (!Array.isArray(room.usedQuestions.wouldyourather)) {
      room.usedQuestions.wouldyourather = [];
    }

    if (room.usedQuestions.wouldyourather.length >= pool.length) {
      room.usedQuestions.wouldyourather = [];
    }

    const availableIndexes = pool
      .map((_, index) => index)
      .filter((index) => !room.usedQuestions.wouldyourather.includes(index));

    if (availableIndexes.length === 0) {
      room.usedQuestions.wouldyourather = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    room.usedQuestions.wouldyourather = [...room.usedQuestions.wouldyourather, selectedIndex];
    return pool[selectedIndex];
  };

  // =============================================
  // WOULD YOU RATHER
  // =============================================

  bot.onText(/\/wouldyourather/, (msg) => {
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

    if (rooms[chatId].gameMode !== "wouldyourather") {
      return bot.sendMessage(
        chatId,
        "⚠️ Mode game saat ini bukan Would You Rather."
      );
    }

    const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

    if (!currentPlayer) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
    }

    if (msg.from.id !== currentPlayer.id) {
      return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
    }

    const question = pickUnusedQuestion(rooms[chatId], questions) || questions[0];

    bot.sendMessage(
      chatId,
      `🤔 WOULD YOU RATHER

🎯 Giliran: ${currentPlayer.name}

━━━━━━━━━━━━━━

${question}

━━━━━━━━━━━━━━

➡️ Ketik /next untuk pemain berikutnya`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "⏭ Next",
                callback_data: "next"
              }
            ],
            [
              {
                text: "🛑 End Game",
                callback_data: "endgame"
              }
            ]
          ]
        }
      }
    );
  });

};
