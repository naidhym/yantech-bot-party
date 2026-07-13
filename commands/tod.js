const truths = require("../data/truth.json");
const dares = require("../data/dare.json");
const { pickUnusedQuestion, createSafeSend } = require("./_utils");

module.exports = (bot, rooms, statsStore) => {
  const safeSend = createSafeSend(bot);

  // =============================================
  // SPIN COMMAND
  // =============================================

  bot.onText(/\/spin/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "⚠️ Belum ada room. Ketik /join terlebih dahulu.");
      }

      if (!rooms[chatId].started) {
        return safeSend(chatId, "⚠️ Game belum dimulai.");
      }

      if (rooms[chatId].gameMode !== "tod") {
        return safeSend(chatId, "⚠️ Mode game saat ini bukan Truth or Dare.");
      }

      const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

      if (!currentPlayer) {
        return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
      }

      if (msg.from.id !== currentPlayer.id) {
        return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
      }

      const isTruth = Math.random() < 0.5;
      const pool = isTruth ? truths : dares;
      const selectedQuestion = pickUnusedQuestion(rooms[chatId], isTruth ? "truth" : "dare", pool);
      const question = selectedQuestion?.item || pool[0];
      statsStore?.recordQuestion(isTruth ? "truth" : "dare");

      const mode = isTruth ? "❓ TRUTH" : "🔥 DARE";

      safeSend(
        chatId,
        `🎯 Giliran: ${currentPlayer.name}

🎲 Hasil Spin
━━━━━━━━━━━━━━

${mode}

${question}

━━━━━━━━━━━━━━
➡️ Ketik /next untuk pemain berikutnya`
      );
    } catch (error) {
      console.error("/spin handler error:", error.message || error);
    }
  });
};
