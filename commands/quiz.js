const questions = require("../data/quiz.json");
const { pickUnusedQuestion, createSafeSend } = require("./_utils");

module.exports = (bot, rooms, statsStore) => {
  const safeSend = createSafeSend(bot);

  bot.onText(/\/quiz/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "⚠️ Belum ada room. Ketik /join terlebih dahulu.");
      }

      if (!rooms[chatId].started) {
        return safeSend(chatId, "⚠️ Game belum dimulai.");
      }

      if (rooms[chatId].gameMode !== "quiz") {
        return safeSend(chatId, "⚠️ Mode game saat ini bukan Quiz.");
      }

      if (rooms[chatId].currentQuiz) {
        return safeSend(chatId, "⚠️ Masih ada soal yang belum dijawab.");
      }

      if (!Array.isArray(questions) || questions.length === 0) {
        return safeSend(chatId, "⚠️ Data quiz belum tersedia.");
      }

      const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

      if (!currentPlayer) {
        return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
      }

      if (msg.from.id !== currentPlayer.id) {
        return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
      }

      const selectedQuestion = pickUnusedQuestion(rooms[chatId], "quiz", questions);
      const questionData = selectedQuestion?.item || questions[0];
      const questionIndex = selectedQuestion?.index ?? 0;
      statsStore?.recordQuestion("quiz");

      if (
        !questionData ||
        !Array.isArray(questionData.options) ||
        questionData.options.length < 2 ||
        typeof questionData.answer !== "number"
      ) {
        return safeSend(chatId, "⚠️ Format data quiz salah.");
      }

      rooms[chatId].currentQuiz = {
        index: questionIndex,
        correctIndex: questionData.answer,
      };

      return safeSend(
        chatId,
        `🧠 QUIZ

🎯 Giliran: ${currentPlayer.name}

━━━━━━━━━━━━━━

${questionData.question}

━━━━━━━━━━━━━━

Pilih jawaban:`,
        {
          reply_markup: {
            inline_keyboard: [
              ...questionData.options.map((opt, idx) => [
                { text: opt, callback_data: `quiz_answer_${idx}` },
              ]),
              [{ text: "🛑 End Game", callback_data: "endgame" }],
            ],
          },
        }
      );
    } catch (error) {
      console.error("/quiz handler error:", error.message || error);
    }
  });
};
