const nhie = require("../data/neverhaveiever.json");
const { pickUnusedQuestion, createSafeSend } = require("./_utils");

module.exports = (bot, rooms, statsStore) => {
  const safeSend = createSafeSend(bot);

  // =============================================
  // NEVER HAVE I EVER COMMAND
  // =============================================

  bot.onText(/\/neverhaveiever/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId] || !rooms[chatId].started) {
        return safeSend(chatId, "Game belum dimulai.");
      }

      if (rooms[chatId].gameMode !== "neverhaveiever") {
        return safeSend(chatId, "⚠️ Mode game saat ini bukan NHIE.");
      }

      const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

      if (!currentPlayer) {
        return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
      }

      if (msg.from.id !== currentPlayer.id) {
        return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
      }

      const selectedQuestion = pickUnusedQuestion(rooms[chatId], "neverhaveiever", nhie);
      const question = selectedQuestion?.item || nhie[0];
      statsStore?.recordQuestion("neverhaveiever");

      safeSend(
        chatId,
        `🍻 NEVER HAVE I EVER

    🎯 Giliran:
    ${currentPlayer.name}

    ${question}

    ➡️ Ketik /next untuk lanjut ke pemain berikutnya.`
      );
    } catch (error) {
      console.error("/neverhaveiever handler error:", error.message || error);
    }
  });
};
