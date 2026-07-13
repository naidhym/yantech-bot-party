const questions = require("../data/wouldyourather.json");
const { pickUnusedQuestion, createSafeSend } = require("./_utils");

module.exports = (bot, rooms, statsStore) => {
  const safeSend = createSafeSend(bot);

  // =============================================
  // WOULD YOU RATHER
  // =============================================

  bot.onText(/\/wouldyourather/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "⚠️ Belum ada room. Ketik /join terlebih dahulu.");
      }

      if (!rooms[chatId].started) {
        return safeSend(chatId, "⚠️ Game belum dimulai.");
      }

      if (rooms[chatId].gameMode !== "wouldyourather") {
        return safeSend(chatId, "⚠️ Mode game saat ini bukan Would You Rather.");
      }

      const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

      if (!currentPlayer) {
        return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
      }

      if (msg.from.id !== currentPlayer.id) {
        return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
      }

      const selectedQuestion = pickUnusedQuestion(rooms[chatId], "wouldyourather", questions);
      const question = selectedQuestion?.item || questions[0];
      statsStore?.recordQuestion("wouldyourather");

      safeSend(
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
              [{ text: "⏭ Next", callback_data: "next" }],
              [{ text: "🛑 End Game", callback_data: "endgame" }],
            ],
          },
        }
      ).then((sentMessage) => {
        // Register this as the single valid "Next" button, same as the
        // callback-driven WYR flow, so it's covered by the same
        // stale/duplicate-button protection in core.js's "next" handler.
        if (sentMessage && rooms[chatId]) {
          rooms[chatId].activeNextMessageId = sentMessage.message_id;
        }
      });
    } catch (error) {
      console.error("/wouldyourather handler error:", error.message || error);
    }
  });
};
