const questions = require("../data/quiz.json");

module.exports = (bot, rooms, statsStore) => {

  const pickUnusedQuestion = (room, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }

    if (!room.usedQuestions) {
      room.usedQuestions = {};
    }

    if (!Array.isArray(room.usedQuiz)) {
      room.usedQuiz = [];
    }

    if (!Array.isArray(room.usedQuestions.quiz)) {
      room.usedQuestions.quiz = [];
    }

    if (room.usedQuiz.length >= pool.length) {
      room.usedQuiz = [];
      room.usedQuestions.quiz = [];
    }

    const availableIndexes = pool
      .map((_, index) => index)
      .filter((index) => !room.usedQuiz.includes(index));

    if (availableIndexes.length === 0) {
      room.usedQuiz = [];
      room.usedQuestions.quiz = [];
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    room.usedQuiz = [...room.usedQuiz, selectedIndex];
    room.usedQuestions.quiz = [...room.usedQuestions.quiz, selectedIndex];
    return pool[selectedIndex];
  };

  bot.onText(/\/quiz/, (msg) => {
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

    if (rooms[chatId].gameMode !== "quiz") {
      return bot.sendMessage(
        chatId,
        "⚠️ Mode game saat ini bukan Quiz."
      );
    }

    if (rooms[chatId].currentQuiz) {
      return bot.sendMessage(
        chatId,
        "⚠️ Masih ada soal yang belum dijawab."
      );
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      return bot.sendMessage(
        chatId,
        "⚠️ Data quiz belum tersedia."
      );
    }

    const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

    if (!currentPlayer) {
      return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
    }

    if (msg.from.id !== currentPlayer.id) {
      return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
    }

    const selectedQuestion = pickUnusedQuestion(rooms[chatId], questions);
    statsStore?.recordQuestion("quiz");
    const questionData = selectedQuestion || questions[0];
    const questionIndex = selectedQuestion ? questions.indexOf(selectedQuestion) : 0;

    if (
      !questionData ||
      !Array.isArray(questionData.options) ||
      questionData.options.length < 2 ||
      typeof questionData.answer !== "number"
    ) {
      return bot.sendMessage(
        chatId,
        "⚠️ Format data quiz salah."
      );
    }

    rooms[chatId].currentQuiz = {
      index: questionIndex,
      correctIndex: questionData.answer
    };

    return bot.sendMessage(
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
              {
                text: opt,
                callback_data: `quiz_answer_${idx}`
              }
            ]),
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