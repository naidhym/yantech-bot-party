const path = require("path");

module.exports = (bot, rooms, statsStore) => {

  const getCurrentPlayer = (room) => room?.players?.[room.currentTurn] || null;

  const getOwnerId = () => {
    try {
      require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
    } catch (error) {
      // ignore
    }

    return (process.env.OWNER_ID || "").toString().trim();
  };

  const isOwner = (userId) => {
    const ownerId = getOwnerId();
    return userId != null && ownerId !== "" && String(ownerId) === String(userId);
  };
  const registerUserAndGroup = (chat, userId) => {
    if (!statsStore) {
      return;
    }

    if (userId != null) {
      statsStore.ensureUser(userId);
    }

    if (chat?.type && ["group", "supergroup"].includes(chat.type)) {
      statsStore.ensureGroup(chat.id);
    }
  };

  const getMainMenuKeyboard = (userId) => {
    const keyboard = [
      [{ text: "➕ Join", callback_data: "join" }],
      [{ text: "👥 Players", callback_data: "players" }],
      [{ text: "🎮 Start Game", callback_data: "startmenu" }],
      [
        { text: "🏆 Score", callback_data: "score" },
        { text: "ℹ️ Help", callback_data: "help" },
      ],
      [{ text: "🚪 Leave", callback_data: "leave_room" }],
    ];

    if (isOwner(userId)) {
      keyboard.push([{ text: "📊 Stats", callback_data: "stats" }]);
    }

    return keyboard;
  };

  const formatUptime = () => {
    const totalSeconds = Math.floor(process.uptime());
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${days} hari ${hours} jam ${minutes} menit`;
  };

  const ensureUsedQuestionState = (room) => {
    if (!room) {
      return room;
    }

    if (!room.usedQuestions) {
      room.usedQuestions = {};
    }

    if (!Array.isArray(room.usedTruth)) {
      room.usedTruth = [];
    }

    if (!Array.isArray(room.usedDare)) {
      room.usedDare = [];
    }

    if (!Array.isArray(room.usedNHIE)) {
      room.usedNHIE = [];
    }

    if (!Array.isArray(room.usedWYR)) {
      room.usedWYR = [];
    }

    if (!Array.isArray(room.usedQuiz)) {
      room.usedQuiz = [];
    }

    return room;
  };

  const resetUsedQuestionState = (room) => {
    ensureUsedQuestionState(room);
    room.usedTruth = [];
    room.usedDare = [];
    room.usedNHIE = [];
    room.usedWYR = [];
    room.usedQuiz = [];
    room.usedQuestions = {};
    return room;
  };

  const getUsedQuestionList = (room, key, legacyKey) => {
    ensureUsedQuestionState(room);

    if (Array.isArray(room[key])) {
      return room[key];
    }

    if (room.usedQuestions && Array.isArray(room.usedQuestions[legacyKey])) {
      room[key] = [...room.usedQuestions[legacyKey]];
      return room[key];
    }

    room[key] = [];
    return room[key];
  };

  const pickUnusedQuestion = (room, mode, pool) => {
    if (!Array.isArray(pool) || pool.length === 0) {
      return null;
    }

    ensureUsedQuestionState(room);

    const keyMap = {
      truth: "usedTruth",
      dare: "usedDare",
      neverhaveiever: "usedNHIE",
      wouldyourather: "usedWYR",
      quiz: "usedQuiz",
    };

    const stateKey = keyMap[mode] || null;
    const usedList = stateKey ? getUsedQuestionList(room, stateKey, mode) : [];

    if (usedList.length >= pool.length) {
      room[stateKey] = [];
      room.usedQuestions[mode] = [];
    }

    const availableIndexes = pool
      .map((_, index) => index)
      .filter((index) => !room[stateKey].includes(index));

    if (availableIndexes.length === 0) {
      room[stateKey] = [];
      room.usedQuestions[mode] = [];
      return {
        item: pool[Math.floor(Math.random() * pool.length)],
        index: Math.floor(Math.random() * pool.length),
      };
    }

    const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    room[stateKey] = [...room[stateKey], selectedIndex];
    room.usedQuestions[mode] = [...room.usedQuestions[mode] || [], selectedIndex];

    return {
      item: pool[selectedIndex],
      index: selectedIndex,
    };
  };

  const getModeLabel = (mode) => {
    switch (mode) {
      case "neverhaveiever":
        return "NHIE";
      case "wouldyourather":
        return "WYR";
      case "quiz":
        return "Quiz";
      case "tod":
      default:
        return "TOD";
    }
  };

  const getNextAction = (mode) => {
    switch (mode) {
      case "neverhaveiever":
        return { text: "🍻 NHIE", callback: "nhie" };
      case "wouldyourather":
        return { text: "🤔 WYR", callback: "wyr" };
      case "quiz":
        return { text: "🧠 Quiz", callback: "quiz" };
      case "tod":
      default:
        return { text: "🎲 Spin", callback: "spin" };
    }
  };

  const showEndGameOptions = (botInstance, chatId) => {
    return botInstance.sendMessage(
      chatId,
      "🛑 Game selesai. Mau lanjutkan apa?",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🗑 Bubarkan room",
                callback_data: "dismiss_room",
              },
              {
                text: "🎮 Pilih game lain",
                callback_data: "startmenu",
              },
            ],
          ],
        },
      }
    );
  };

  // =============================================
// START COMMAND
// =============================================

bot.onText(/\/start/, async (msg) => {

  const chatId = msg.chat.id;
  registerUserAndGroup(msg.chat, msg.from.id);

  // Kirim menu utama
  await bot.sendMessage(
    chatId,
    `🎮 YANTECH PARTY GAMES

Selamat datang!

Gunakan tombol di bawah untuk bermain.

━━━━━━━━━━━━━━
👨‍💻 Created by @YanTechn0
💬 Kritik & Saran: @KritSarYanTechPartyGamesBot`,
    {
      reply_markup: {
        inline_keyboard: getMainMenuKeyboard(msg.from.id)
      }
    }
  );

});

  // =============================================
// HELP COMMAND
// =============================================

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(chatId, "⚠️ Hanya owner yang dapat melihat statistik bot.");
  }

  const stats = statsStore?.get?.() || { users: [], groups: [], totalGames: 0, gameModes: {}, totalTruth: 0, totalDare: 0, totalNeverHaveIEver: 0, totalWouldYouRather: 0, totalQuiz: 0 };
  const gameModes = stats.gameModes || {};

  return bot.sendMessage(
    chatId,
    `📊 YANTECH PARTY GAMES STATS

👤 Total Users : ${stats.users.length}
👥 Total Groups : ${stats.groups.length}
🎮 Total Games : ${stats.totalGames}

Mode dimainkan
🎲 Truth or Dare : ${Number(gameModes.truthdare || 0)}
🙅 Never Have I Ever : ${Number(gameModes.neverhaveiever || 0)}
🤔 Would You Rather : ${Number(gameModes.wouldyourather || 0)}
🧠 Quiz : ${Number(gameModes.quiz || 0)}

Bot Uptime:
${formatUptime()}`
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📖 YANTECH PARTY GAMES

━━━━━━━━━━━━━━

👥 ROOM
• /join — Masuk ke room
• /leave — Keluar dari room
• /players — Lihat daftar pemain
• /host — Lihat host aktif
• /shuffle — Acak urutan pemain

🎮 MULAI GAME
• /startgame tod — mulai Truth or Dare
• /startgame neverhaveiever — mulai NHIE
• /startgame wouldyourather — mulai WYR
• /startgame quiz — mulai quiz

🎲 GAME PLAY
• /spin — ambil soal TOD saat giliran Anda
• /neverhaveiever — ambil soal NHIE saat giliran Anda
• /wouldyourather — ambil soal WYR saat giliran Anda
• /quiz — tampilkan soal quiz saat giliran Anda
• /next — lanjut ke pemain berikutnya
• /endgame — akhiri permainan

💡 CARA CEPAT
1. Semua pemain ketik /join
2. Host ketik /startgame <mode>
3. Ikuti pertanyaan saat giliran Anda
4. Gunakan /next untuk lanjut ke pemain berikutnya
5. Gunakan /endgame untuk mengakhiri sesi

🏆 SCORE
• /score — lihat leaderboard

━━━━━━━━━━━━━━

Kritik & Saran: @KritSarYanTechPartyGamesBot

🤖 Yantech Party Games`
  );
});

// =============================================
// JOIN COMMAND
// =============================================

bot.onText(/\/join/, (msg) => {
  const chatId = msg.chat.id;
  registerUserAndGroup(msg.chat, msg.from.id);

  if (!rooms[chatId]) {
    rooms[chatId] = {
      players: [],
      currentTurn: 0,
      started: false,
      hostId: msg.from.id,
      gameMode: null,
      usedQuestions: {},
      usedTruth: [],
      usedDare: [],
      usedNHIE: [],
      usedWYR: [],
      usedQuiz: [],
      currentQuiz: null,
    };
  }

  const playerExists = rooms[chatId].players.find(
    (player) => player.id === msg.from.id
  );

  if (playerExists) {
    return bot.sendMessage(
      chatId,
      "⚠️ Kamu sudah bergabung."
    );
  }

  rooms[chatId].players.push({
    id: msg.from.id,
    name: msg.from.first_name,
    score: 0,
  });

  bot.sendMessage(
    chatId,
    `✅ ${msg.from.first_name} berhasil bergabung!`
  );
});

// =============================================
// PLAYERS COMMAND
// =============================================

bot.onText(/\/players/, (msg) => {
  const chatId = msg.chat.id;

  if (
    !rooms[chatId] ||
    rooms[chatId].players.length === 0
  ) {
    return bot.sendMessage(
      chatId,
      "Belum ada pemain."
    );
  }

  const list = rooms[chatId].players
    .map((player, index) => `${index + 1}. ${player.name}`)
    .join("\n");

  bot.sendMessage(
    chatId,
    `📋 Daftar Pemain:\n\n${list}`
  );
});

// =============================================
// START GAME COMMAND
// =============================================

bot.onText(/\/startgame (.+)/, (msg, match) => {
  const chatId = msg.chat.id;

  const game = match[1].toLowerCase();

  const validGames = [
    "tod",
    "neverhaveiever",
    "wouldyourather",
    "quiz"
  ];

  if (!validGames.includes(game)) {
    return bot.sendMessage(
      chatId,
      `❌ Game tidak ditemukan.

Game tersedia:
• tod
• neverhaveiever
• wouldyourather
• quiz`
    );
  }

  if (!rooms[chatId]) {
    return bot.sendMessage(
      chatId,
      "Belum ada pemain yang bergabung."
    );
  }

  if (msg.from.id !== rooms[chatId].hostId) {
    return bot.sendMessage(
      chatId,
      "⚠️ Hanya host yang bisa memulai game."
    );
  }

  if (rooms[chatId].players.length < 2) {
    return bot.sendMessage(
      chatId,
      "Minimal 2 pemain untuk memulai game."
    );
  }

  rooms[chatId].gameMode = game;
  rooms[chatId].started = true;
  rooms[chatId].currentTurn = 0;
  resetUsedQuestionState(rooms[chatId]);
  rooms[chatId].currentQuiz = null;
  statsStore?.recordGameStart(game);

  const currentPlayer =
    rooms[chatId].players[0];

  bot.sendMessage(
    chatId,
    `🎮 GAME DIMULAI!

🎲 Mode:
${game}

🎯 Giliran pertama:
${currentPlayer.name}`
  );
});

// =============================================
// NEXT PLAYER COMMAND
// =============================================

bot.onText(/\/next/, (msg) => {
  const chatId = msg.chat.id;

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(
      chatId,
      "Game belum dimulai."
    );
  }

  rooms[chatId].currentTurn =
    (rooms[chatId].currentTurn + 1) %
    rooms[chatId].players.length;

  const currentPlayer =
    rooms[chatId].players[
      rooms[chatId].currentTurn
    ];

  let nextCommand = "/spin";

  switch (rooms[chatId].gameMode) {
    case "neverhaveiever":
      nextCommand = "/neverhaveiever";
      break;

    case "wouldyourather":
      nextCommand = "/wouldyourather";
      break;

    case "quiz":
      nextCommand = "/quiz";
      break;

    case "tod":
    default:
      nextCommand = "/spin";
      break;
  }

  bot.sendMessage(
    chatId,
    `🎯 Giliran berikutnya:

${currentPlayer.name}

🎮 Mode: ${rooms[chatId].gameMode}

➡️ Ketik ${nextCommand}`
  );
});

// =============================================
// END GAME COMMAND
// =============================================

bot.onText(/\/endgame/, (msg) => {
  const chatId = msg.chat.id;

  if (!rooms[chatId]) {
    return bot.sendMessage(
      chatId,
      "⚠️ Belum ada room."
    );
  }

  if (msg.from.id !== rooms[chatId].hostId) {
    return bot.sendMessage(
      chatId,
      "❌ Hanya host yang dapat mengakhiri permainan."
    );
  }

  const gameMode =
    rooms[chatId].gameMode || "Tidak diketahui";

  rooms[chatId].started = false;
  rooms[chatId].currentTurn = 0;
  rooms[chatId].gameMode = null;
  rooms[chatId].currentQuiz = null;

  return showEndGameOptions(bot, chatId, gameMode);
});

// =============================================
// LEAVE COMMAND
// =============================================

bot.onText(/\/leave/, (msg) => {
  const chatId = msg.chat.id;

  if (!rooms[chatId]) {
    return;
  }

  // Cek apakah yang keluar adalah host
  const isHost =
    msg.from.id === rooms[chatId].hostId;

  // Hapus pemain dari room
  rooms[chatId].players =
    rooms[chatId].players.filter(
      (player) => player.id !== msg.from.id
    );

  // Jika host keluar dan masih ada pemain
  if (
    isHost &&
    rooms[chatId].players.length > 0
  ) {
    rooms[chatId].hostId =
      rooms[chatId].players[0].id;

    bot.sendMessage(
      chatId,
      `👑 Host baru: ${rooms[chatId].players[0].name}`
    );
  }

  // Jika semua pemain keluar
  if (rooms[chatId].players.length === 0) {
    delete rooms[chatId];

    return bot.sendMessage(
    chatId,
    `🔴 Room berhasil dibubarkan.

Terima kasih sudah bermain di YANTECH PARTY GAMES! 🎉

━━━━━━━━━━━━━━
👨‍💻 Created by @YanTechn0
💬 Kritik & Saran: @KritSarYanTechPartyGamesBot`
);
  }

  bot.sendMessage(
    chatId,
    `❌ ${msg.from.first_name} keluar dari permainan.`
  );
});

// =============================================
// SHUFFLE COMMAND
// =============================================

bot.onText(/\/shuffle/, (msg) => {
  const chatId = msg.chat.id;

  if (
    !rooms[chatId] ||
    rooms[chatId].players.length < 2
  ) {
    return bot.sendMessage(
      chatId,
      "Minimal 2 pemain."
    );
  }

  rooms[chatId].players.sort(
    () => Math.random() - 0.5
  );

  const list = rooms[chatId].players
    .map((player, index) =>
      `${index + 1}. ${player.name}`
    )
    .join("\n");

  bot.sendMessage(
    chatId,
    `🔀 Urutan pemain berhasil diacak!\n\n${list}`
  );
});

// =============================================
// HOST COMMAND
// =============================================

bot.onText(/\/host/, (msg) => {
  const chatId = msg.chat.id;

  if (!rooms[chatId]) {
    return bot.sendMessage(
      chatId,
      "Belum ada room."
    );
  }

  const host = rooms[chatId].players.find(
    (player) => player.id === rooms[chatId].hostId
  );

  bot.sendMessage(
    chatId,
    `👑 Host saat ini: ${host?.name || "Tidak ditemukan"}`
  );
});

// =============================================
// SCORE COMMAND
// =============================================

bot.onText(/\/score/, (msg) => {
  const chatId = msg.chat.id;

  if (!rooms[chatId]) {
    return bot.sendMessage(
      chatId,
      "⚠️ Belum ada room."
    );
  }

  const ranking = [...rooms[chatId].players]
    .sort((a, b) => b.score - a.score)
    .map(
      (player, index) =>
        `${index + 1}. ${player.name} — ${player.score} poin`
    )
    .join("\n");

  bot.sendMessage(
    chatId,
    `🏆 LEADERBOARD

━━━━━━━━━━━━━━

${ranking}`
  );
});

// =============================================
// BUTTON HANDLER
// =============================================

bot.on("callback_query", async (query) => {

  const chatId = query.message.chat.id;
  const data = query.data;
  registerUserAndGroup(query.message?.chat, query.from.id);

  const answerCallback = async (text, showAlert = false) => {
    try {
      await bot.answerCallbackQuery(query.id, text ? { text, show_alert: showAlert } : undefined);
    } catch (error) {
      console.warn("Callback query response failed:", error.message || error);
    }
  };

  if (!rooms[chatId]) {
    rooms[chatId] = {
      players: [],
      currentTurn: 0,
      started: false,
      hostId: query.from.id,
      gameMode: null,
      usedQuestions: {},
      usedTruth: [],
      usedDare: [],
      usedNHIE: [],
      usedWYR: [],
      usedQuiz: [],
      currentQuiz: null,
      processedCallbacks: {},
    };
  }

  const room = rooms[chatId];
  const callbackKey = `${query.message?.message_id || 0}:${data}`;

  if (room.processedCallbacks?.[callbackKey]) {
    await answerCallback("⏳ Tombol ini sudah diproses.");
    return;
  }

  room.processedCallbacks = room.processedCallbacks || {};
  room.processedCallbacks[callbackKey] = true;

  // =========================
  // JOIN
  // =========================

  if (data === "join") {
    await answerCallback();

    if (!rooms[chatId]) {
      rooms[chatId] = {
        players: [],
        currentTurn: 0,
        started: false,
        hostId: query.from.id,
        gameMode: null,
        usedQuestions: {},
        usedTruth: [],
        usedDare: [],
        usedNHIE: [],
        usedWYR: [],
        usedQuiz: [],
        currentQuiz: null,
        processedCallbacks: {},
      };
    }

    const playerExists = rooms[chatId].players.find(
      player => player.id === query.from.id
    );

    if (playerExists) {
      return bot.sendMessage(
        chatId,
        "⚠️ Kamu sudah bergabung."
      );
    }

    rooms[chatId].players.push({
      id: query.from.id,
      name: query.from.first_name,
      score: 0,
    });

    return bot.sendMessage(
      chatId,
      `✅ ${query.from.first_name} berhasil bergabung!`
    );
  }

  // =========================
  // PLAYERS
  // =========================

  if (data === "players") {
    await answerCallback();

    if (
      !rooms[chatId] ||
      rooms[chatId].players.length === 0
    ) {
      return bot.sendMessage(
        chatId,
        "Belum ada pemain."
      );
    }

    const list = rooms[chatId].players
      .map((p, i) => `${i + 1}. ${p.name}`)
      .join("\n");

    return bot.sendMessage(
      chatId,
      `📋 Daftar Pemain:\n\n${list}`
    );
  }

  // =========================
  // HELP
  // =========================

  if (data === "help") {
    await answerCallback();

    return bot.sendMessage(
      chatId,
      `📖 YANTECH PARTY GAMES

━━━━━━━━━━━━━━

👥 ROOM
• Join — masuk ke room
• Players — lihat daftar pemain
• Start Game — pilih mode permainan

🎲 GAMES
• TOD — Truth or Dare
• NHIE — Never Have I Ever
• WYR — Would You Rather
• Quiz — kuis singkat

🛠️ KONTROL
• Spin / NHIE / WYR / Quiz — main saat giliran Anda
• Next — lanjut ke pemain berikutnya
• End Game — akhiri sesi

🤖 Yantech Party Games`
    );
  }

  // =========================
  // SCORE BUTTON
  // =========================

  if (data === "score") {
    await answerCallback();

    if (!rooms[chatId]) {
      return bot.sendMessage(
        chatId,
        "⚠️ Belum ada room."
      );
    }

    const ranking = [...rooms[chatId].players]
      .sort((a, b) => b.score - a.score)
      .map(
        (player, index) =>
          `${index + 1}. ${player.name} — ${player.score} poin`
      )
      .join("\n");

    return bot.sendMessage(
      chatId,
  `🏆 LEADERBOARD

  ━━━━━━━━━━━━━━

  ${ranking}`
    );
  }

  // =========================
  // START MENU
  // =========================

  if (data === "startmenu") {
    await answerCallback();

    return bot.sendMessage(
      chatId,
      "🎮 Pilih Game",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🎲 TOD", callback_data: "start_tod" }],
            [{ text: "🍻 NHIE", callback_data: "start_nhie" }],
            [{ text: "🤔 WYR", callback_data: "start_wyr" }],
            [{ text: "🧠 Quiz", callback_data: "start_quiz" }],
            [{ text: "🚪 Leave", callback_data: "leave_room" }],
            ...(isOwner(query.from.id) ? [[{ text: "📊 Stats", callback_data: "stats" }]] : [])
          ]
        }
      }
    );
  }

  // =========================
  // START TOD
  // =========================

  if (data === "start_tod") {
    await answerCallback();

    if (!rooms[chatId])
      return bot.sendMessage(chatId, "Belum ada pemain yang bergabung.");

    if (query.from.id !== rooms[chatId].hostId)
      return bot.sendMessage(chatId, "⚠️ Hanya host yang bisa memulai game.");

    if (rooms[chatId].players.length < 2)
      return bot.sendMessage(chatId, "Minimal 2 pemain untuk memulai game.");

    rooms[chatId].gameMode = "tod";
    rooms[chatId].started = true;
    rooms[chatId].currentTurn = 0;
    resetUsedQuestionState(rooms[chatId]);
    rooms[chatId].currentQuiz = null;
    statsStore?.recordGameStart("tod");

    return bot.sendMessage(
    chatId,
    `🎮 GAME DIMULAI!

  🎲 Mode: TOD

  🎯 Giliran pertama:
  ${rooms[chatId].players[0].name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🎲 Spin",
              callback_data: "spin"
            }
          ]
        ]
      }
    }
  );
  }

  // =========================
  // START NHIE
  // =========================

  if (data === "start_nhie") {
    await answerCallback();

    if (!rooms[chatId])
      return bot.sendMessage(chatId, "Belum ada pemain yang bergabung.");

    if (query.from.id !== rooms[chatId].hostId)
      return bot.sendMessage(chatId, "⚠️ Hanya host yang bisa memulai game.");

    if (rooms[chatId].players.length < 2)
      return bot.sendMessage(chatId, "Minimal 2 pemain untuk memulai game.");

    rooms[chatId].gameMode = "neverhaveiever";
    rooms[chatId].started = true;
    rooms[chatId].currentTurn = 0;
    resetUsedQuestionState(rooms[chatId]);
    rooms[chatId].currentQuiz = null;
    statsStore?.recordGameStart("neverhaveiever");

    return bot.sendMessage(
    chatId,
    `🎮 GAME DIMULAI!

  🍻 Mode: NHIE

  🎯 Giliran pertama:
  ${rooms[chatId].players[0].name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
            text: "🍻 NHIE",
            callback_data: "nhie"
            }
          ]
        ]
      }
    }
  );
  }

  // =========================
  // START WYR
  // =========================

  if (data === "start_wyr") {
    await answerCallback();

    if (!rooms[chatId])
      return bot.sendMessage(chatId, "Belum ada pemain yang bergabung.");

    if (query.from.id !== rooms[chatId].hostId)
      return bot.sendMessage(chatId, "⚠️ Hanya host yang bisa memulai game.");

    if (rooms[chatId].players.length < 2)
      return bot.sendMessage(chatId, "Minimal 2 pemain untuk memulai game.");

    rooms[chatId].gameMode = "wouldyourather";
rooms[chatId].started = true;
rooms[chatId].currentTurn = 0;
resetUsedQuestionState(rooms[chatId]);
rooms[chatId].currentQuiz = null;
statsStore?.recordGameStart("wouldyourather");

return bot.sendMessage(
  chatId,
  `🎮 GAME DIMULAI!

🤔 Mode: WYR

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
  {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🤔 WYR",
            callback_data: "wyr"
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
  }

  // =========================
  // START QUIZ
  // =========================

  if (data === "start_quiz") {
    await answerCallback();

  if (!rooms[chatId])
    return bot.sendMessage(chatId, "Belum ada pemain yang bergabung.");

  if (query.from.id !== rooms[chatId].hostId)
    return bot.sendMessage(chatId, "⚠️ Hanya host yang bisa memulai game.");

  if (rooms[chatId].players.length < 2)
    return bot.sendMessage(chatId, "Minimal 2 pemain untuk memulai game.");

  rooms[chatId].gameMode = "quiz";
  rooms[chatId].started = true;
  rooms[chatId].currentTurn = 0;
  resetUsedQuestionState(rooms[chatId]);
  rooms[chatId].currentQuiz = null;
  statsStore?.recordGameStart("quiz");

  return bot.sendMessage(
    chatId,
    `🎮 GAME DIMULAI!

🧠 Mode: Quiz

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🧠 Quiz",
              callback_data: "quiz"
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
}

// =========================
// SPIN
// =========================

if (data === "spin") {
  await answerCallback();

  const currentPlayer = getCurrentPlayer(rooms[chatId]);

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
  }

  if (query.from.id !== currentPlayer.id) {
    return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
  }

  if (rooms[chatId].gameMode !== "tod") {
    return bot.sendMessage(
      chatId,
      "⚠️ Mode game saat ini bukan TOD."
    );
  }

  const truths = require("../data/truth.json");
  const dares = require("../data/dare.json");

  const isTruth = Math.random() < 0.5;
  const pool = isTruth ? truths : dares;
  const selectedQuestion = pickUnusedQuestion(rooms[chatId], isTruth ? "truth" : "dare", pool);
  const question = selectedQuestion?.item || (isTruth ? truths[0] : dares[0]);
  statsStore?.recordQuestion(isTruth ? "truth" : "dare");

  const mode = isTruth
    ? "❓ TRUTH"
    : "🔥 DARE";

  return bot.sendMessage(
    chatId,
    `🎯 Giliran: ${currentPlayer.name}

🎲 Hasil Spin
━━━━━━━━━━━━━━

${mode}

${question}`,
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
}

// =========================
// NHIE
// =========================

if (data === "nhie") {
  await answerCallback();

  const currentPlayer = getCurrentPlayer(rooms[chatId]);

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
  }

  if (query.from.id !== currentPlayer.id) {
    return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
  }

  if (rooms[chatId].gameMode !== "neverhaveiever") {
    return bot.sendMessage(
      chatId,
      "⚠️ Mode game saat ini bukan NHIE."
    );
  }

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(
      chatId,
      "Game belum dimulai."
    );
  }

  const nhie =
    require("../data/neverhaveiever.json");

  const selectedQuestion = pickUnusedQuestion(rooms[chatId], "neverhaveiever", nhie);
  const question = selectedQuestion?.item || nhie[0];
  statsStore?.recordQuestion("neverhaveiever");

  return bot.sendMessage(
    chatId,
    `🍻 NEVER HAVE I EVER

🎯 Giliran:
${currentPlayer.name}

${question}`,
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
}

// =========================
// WYR
// =========================

if (data === "wyr") {
  await answerCallback();

  const currentPlayer = getCurrentPlayer(rooms[chatId]);

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
  }

  if (query.from.id !== currentPlayer.id) {
    return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
  }

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(chatId, "Game belum dimulai.");
  }

  if (rooms[chatId].gameMode !== "wouldyourather") {
    return bot.sendMessage(chatId, "⚠️ Mode game saat ini bukan WYR.");
  }

  const wyr = require("../data/wouldyourather.json");

  const selectedQuestion = pickUnusedQuestion(rooms[chatId], "wouldyourather", wyr);
  const question = selectedQuestion?.item || wyr[0];
  statsStore?.recordQuestion("wouldyourather");

  return bot.sendMessage(
    chatId,
    `🤔 WOULD YOU RATHER

🎯 Giliran: ${currentPlayer.name}

━━━━━━━━━━━━━━

${question}

━━━━━━━━━━━━━━

➡️ Lanjut ke pemain berikutnya`,
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
}

// =========================
// QUIZ
// =========================

if (data === "quiz") {
  await answerCallback();

  const currentPlayer = getCurrentPlayer(rooms[chatId]);

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
  }

  if (query.from.id !== currentPlayer.id) {
    return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
  }

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(chatId, "Game belum dimulai.");
  }

  if (rooms[chatId].gameMode !== "quiz") {
    return bot.sendMessage(chatId, "⚠️ Mode game saat ini bukan Quiz.");
  }

  if (rooms[chatId].currentQuiz) {
    return bot.sendMessage(chatId, "⚠️ Masih ada soal yang belum dijawab.");
  }

  const quizzes = require("../data/quiz.json");

  if (!Array.isArray(quizzes) || quizzes.length === 0) {
    return bot.sendMessage(chatId, "Data quiz belum tersedia.");
  }

  const selectedQuestion = pickUnusedQuestion(rooms[chatId], "quiz", quizzes);
  const questionData = selectedQuestion?.item || quizzes[0];
  const questionIndex = selectedQuestion?.index ?? 0;

  if (
    !questionData ||
    !Array.isArray(questionData.options) ||
    questionData.options.length < 2 ||
    typeof questionData.answer !== "number"
  ) {
    return bot.sendMessage(chatId, "⚠️ Format data quiz salah.");
  }

  rooms[chatId].currentQuiz = {
    index: questionIndex,
    correctIndex: questionData.answer
  };
  statsStore?.recordQuestion("quiz");

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
}

if (data.startsWith("quiz_answer_")) {
  await answerCallback();

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(chatId, "Game belum dimulai.");
  }

  if (rooms[chatId].gameMode !== "quiz") {
    return bot.sendMessage(chatId, "⚠️ Mode game saat ini bukan Quiz.");
  }

  if (!rooms[chatId].currentQuiz) {
    return bot.sendMessage(chatId, "⚠️ Soal quiz belum aktif.");
  }

  const selectedIndex =
    parseInt(data.replace("quiz_answer_", ""), 10);

  const quizzes = require("../data/quiz.json");
  const questionData = quizzes[rooms[chatId].currentQuiz.index];

  const currentPlayer =
    rooms[chatId].players[rooms[chatId].currentTurn];

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Player tidak ditemukan.");
  }

  const isCorrect =
    selectedIndex === rooms[chatId].currentQuiz.correctIndex;

  if (isCorrect) {
    currentPlayer.score += 1;
  }

  rooms[chatId].currentQuiz = null;

  return bot.sendMessage(
    chatId,
    isCorrect
      ? `✅ Benar!

👤 ${currentPlayer.name}
➕ +1 poin

🏆 Total Poin: ${currentPlayer.score}`
      : `❌ Salah!

👤 ${currentPlayer.name}

📌 Jawaban benar:
${questionData.options[questionData.answer]}`,
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
}

// =========================
// NEXT
// =========================

if (data === "next") {
  await answerCallback();

  const currentPlayer = getCurrentPlayer(rooms[chatId]);

  if (!currentPlayer) {
    return bot.sendMessage(chatId, "⚠️ Tidak ada pemain yang aktif.");
  }

  if (query.from.id !== currentPlayer.id) {
    return bot.sendMessage(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
  }

  if (!rooms[chatId] || !rooms[chatId].started) {
    return bot.sendMessage(chatId, "Game belum dimulai.");
  }

  rooms[chatId].currentTurn =
    (rooms[chatId].currentTurn + 1) %
    rooms[chatId].players.length;

  const nextPlayer = getCurrentPlayer(rooms[chatId]);

  let buttonText;
  let callback;

  switch (rooms[chatId].gameMode) {
    case "tod":
      buttonText = "🎲 Spin";
      callback = "spin";
      break;

    case "neverhaveiever":
      buttonText = "🍻 NHIE";
      callback = "nhie";
      break;

    case "wouldyourather":
      buttonText = "🤔 WYR";
      callback = "wyr";
      break;

    case "quiz":
      buttonText = "🧠 Quiz";
      callback = "quiz";
      break;
  }

  return bot.sendMessage(
    chatId,
    `🎯 Giliran berikutnya:\n\n${nextPlayer?.name || "Pemain berikutnya"}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: buttonText,
              callback_data: callback
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
}

// =========================
// END GAME
// =========================

if (data === "endgame") {

  if (!rooms[chatId]) {
    await answerCallback();
    return bot.sendMessage(
      chatId,
      "⚠️ Belum ada room."
    );
  }

  if (query.from.id !== rooms[chatId].hostId) {
    await answerCallback("❌ Hanya host yang dapat mengakhiri permainan.", true);
    return;
  }

  rooms[chatId].started = false;
  rooms[chatId].currentTurn = 0;
  rooms[chatId].gameMode = null;
  rooms[chatId].currentQuiz = null;

  return showEndGameOptions(bot, chatId);
}

if (data === "stats") {
  await answerCallback();

  if (!isOwner(query.from.id)) {
    return bot.sendMessage(chatId, "⚠️ Hanya owner yang dapat melihat statistik bot.");
  }

  const stats = statsStore?.get?.() || { users: [], groups: [], totalGames: 0, gameModes: {}, totalTruth: 0, totalDare: 0, totalNeverHaveIEver: 0, totalWouldYouRather: 0, totalQuiz: 0 };
  const gameModes = stats.gameModes || {};

  return bot.sendMessage(
    chatId,
    `📊 YANTECH PARTY GAMES STATS

👤 Total Users : ${stats.users.length}
👥 Total Groups : ${stats.groups.length}
🎮 Total Games : ${stats.totalGames}

Mode dimainkan
🎲 Truth or Dare : ${Number(gameModes.truthdare || 0)}
🙅 Never Have I Ever : ${Number(gameModes.neverhaveiever || 0)}
🤔 Would You Rather : ${Number(gameModes.wouldyourather || 0)}
🧠 Quiz : ${Number(gameModes.quiz || 0)}

Bot Uptime:
${formatUptime()}`
  );
}

if (data === "dismiss_room") {
  await answerCallback();
  delete rooms[chatId];
  return bot.sendMessage(chatId, "🗑 Room berhasil dibubarkan.");
}

if (data === "leave_room") {
  await answerCallback();
  if (!rooms[chatId]) {
    return bot.sendMessage(chatId, "⚠️ Belum ada room yang aktif.");
  }

  const isHost = query.from.id === rooms[chatId].hostId;
  rooms[chatId].players = rooms[chatId].players.filter((player) => player.id !== query.from.id);

  if (rooms[chatId].players.length === 0) {
    delete rooms[chatId];
    return bot.sendMessage(chatId, "🚪 Kamu keluar. Room dibubarkan karena tidak ada pemain lagi.");
  }

  if (isHost) {
    rooms[chatId].hostId = rooms[chatId].players[0].id;
  }

  return bot.sendMessage(chatId, "🚪 Kamu keluar dari room.");
}
});
};