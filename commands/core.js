const path = require("path");
const {
  pickUnusedQuestion,
  createSafeSend,
} = require("./_utils");

module.exports = (bot, rooms, statsStore) => {
  // safeSend wraps bot.sendMessage so a Telegram API failure never
  // crashes the process (it just logs and resolves to null instead).
  const safeSend = createSafeSend(bot);

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

  // Canonical shape for a brand-new room. Used by both /join and the
  // "join" button so the room object is only ever defined in one place.
  const createRoom = (hostId) => ({
    players: [],
    currentTurn: 0,
    started: false,
    hostId,
    gameMode: null,
    usedQuestions: {},
    usedTruth: [],
    usedDare: [],
    usedNHIE: [],
    usedWYR: [],
    usedQuiz: [],
    currentQuiz: null,
    // Tracks the message_id of the single most-recently issued "Next"
    // button. Any "next" click whose message doesn't match this is
    // stale (already used, or superseded by a newer one) and rejected.
    activeNextMessageId: null,
  });

  // =============================================
  // CALLBACK DE-DUPLICATION (fixes the join bug + double-click races)
  // =============================================
  // Keyed by chat + message + button + the pressing user, so:
  //  - Different users pressing the same "Join" button on the same
  //    shared message are NOT blocked by each other (this was the root
  //    cause of only the first player being able to join).
  //  - The same user rapidly double/triple-tapping the same button is
  //    still blocked for a short debounce window.
  // Entries expire on their own, so this never becomes a memory leak.
  const CALLBACK_DEBOUNCE_MS = 1200;
  const recentCallbacks = new Map();

  const isDuplicateCallback = (chatId, query, data) => {
    const messageId = query.message?.message_id || 0;
    const userId = query.from.id;
    const key = `${chatId}:${messageId}:${data}:${userId}`;
    const now = Date.now();
    const lastRun = recentCallbacks.get(key);

    if (lastRun && now - lastRun < CALLBACK_DEBOUNCE_MS) {
      return true;
    }

    recentCallbacks.set(key, now);
    return false;
  };

  // Lazily prune expired debounce entries so the map never grows forever.
  const pruneInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of recentCallbacks) {
      if (now - timestamp > CALLBACK_DEBOUNCE_MS) {
        recentCallbacks.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  if (typeof pruneInterval.unref === "function") {
    pruneInterval.unref();
  }

  // =============================================
  // ROOM / TURN SAFE LEAVE HELPER
  // =============================================
  // Shared by /leave and the "leave_room" button so a player leaving
  // mid-game can never leave currentTurn pointing at a stale/invalid
  // index (which previously could freeze the game with "Tidak ada
  // pemain yang aktif" for everyone).
  const removePlayerFromRoom = (room, leavingUserId) => {
    const wasHost = room.hostId === leavingUserId;
    const currentPlayerId = getCurrentPlayer(room)?.id;
    const hadPendingQuizForLeaver = Boolean(room.currentQuiz) && currentPlayerId === leavingUserId;

    room.players = room.players.filter((player) => player.id !== leavingUserId);

    // Turn context just changed - any previously issued "Next" button
    // no longer represents a valid, single-use transition.
    room.activeNextMessageId = null;

    if (room.players.length === 0) {
      return { deleted: true, newHostId: null };
    }

    if (currentPlayerId === leavingUserId) {
      // The player whose turn it was just left -> pass the turn on,
      // wrapping around safely if they were last in the list.
      room.currentTurn = room.currentTurn % room.players.length;
      if (hadPendingQuizForLeaver) {
        room.currentQuiz = null;
      }
    } else {
      // Keep pointing at whoever's turn it actually was.
      const idx = room.players.findIndex((player) => player.id === currentPlayerId);
      room.currentTurn = idx >= 0 ? idx : 0;
    }

    let newHostId = null;
    if (wasHost) {
      room.hostId = room.players[0].id;
      newHostId = room.hostId;
    }

    return { deleted: false, newHostId };
  };

  const showEndGameOptions = (botInstance, chatId) => {
    return botInstance
      .sendMessage(chatId, "🛑 Game selesai. Mau lanjutkan apa?", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🗑 Bubarkan room", callback_data: "dismiss_room" },
              { text: "🎮 Pilih game lain", callback_data: "startmenu" },
            ],
          ],
        },
      })
      .catch((error) => {
        console.error(`showEndGameOptions failed for chat ${chatId}:`, error.message || error);
        return null;
      });
  };

  // =============================================
  // START COMMAND
  // =============================================

  bot.onText(/\/start/, async (msg) => {
    try {
      const chatId = msg.chat.id;
      registerUserAndGroup(msg.chat, msg.from.id);

      await safeSend(
        chatId,
        `🎮 YANTECH PARTY GAMES

Selamat datang!

Gunakan tombol di bawah untuk bermain.

━━━━━━━━━━━━━━
👨‍💻 Created by @YanTechn0
💬 Kritik & Saran: @KritSarYanTechPartyGamesBot`,
        {
          reply_markup: {
            inline_keyboard: getMainMenuKeyboard(msg.from.id),
          },
        }
      );
    } catch (error) {
      console.error("/start handler error:", error.message || error);
    }
  });

  // =============================================
  // STATS COMMAND
  // =============================================

  bot.onText(/\/stats/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!isOwner(msg.from.id)) {
        return safeSend(chatId, "⚠️ Hanya owner yang dapat melihat statistik bot.");
      }

      const stats = statsStore?.get?.() || { users: [], groups: [], totalGames: 0, gameModes: {}, totalTruth: 0, totalDare: 0, totalNeverHaveIEver: 0, totalWouldYouRather: 0, totalQuiz: 0 };
      const gameModes = stats.gameModes || {};

      return safeSend(
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
    } catch (error) {
      console.error("/stats handler error:", error.message || error);
    }
  });

  // =============================================
  // HELP COMMAND
  // =============================================

  bot.onText(/\/help/, (msg) => {
    try {
      safeSend(
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
    } catch (error) {
      console.error("/help handler error:", error.message || error);
    }
  });

  // =============================================
  // JOIN COMMAND
  // =============================================

  bot.onText(/\/join/, (msg) => {
    try {
      const chatId = msg.chat.id;
      registerUserAndGroup(msg.chat, msg.from.id);

      if (!rooms[chatId]) {
        rooms[chatId] = createRoom(msg.from.id);
      }

      if (rooms[chatId].started) {
        return safeSend(chatId, "⚠️ Game sudah dimulai, tidak bisa join sekarang.");
      }

      const playerExists = rooms[chatId].players.find(
        (player) => player.id === msg.from.id
      );

      if (playerExists) {
        return safeSend(chatId, "⚠️ Kamu sudah bergabung.");
      }

      rooms[chatId].players.push({
        id: msg.from.id,
        name: msg.from.first_name,
        score: 0,
      });

      safeSend(chatId, `✅ ${msg.from.first_name} berhasil bergabung!`);
    } catch (error) {
      console.error("/join handler error:", error.message || error);
    }
  });

  // =============================================
  // PLAYERS COMMAND
  // =============================================

  bot.onText(/\/players/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId] || rooms[chatId].players.length === 0) {
        return safeSend(chatId, "Belum ada pemain.");
      }

      const list = rooms[chatId].players
        .map((player, index) => `${index + 1}. ${player.name}`)
        .join("\n");

      safeSend(chatId, `📋 Daftar Pemain:\n\n${list}`);
    } catch (error) {
      console.error("/players handler error:", error.message || error);
    }
  });

  // =============================================
  // START GAME COMMAND
  // =============================================

  bot.onText(/\/startgame (.+)/, (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const game = match[1].toLowerCase();

      const validGames = ["tod", "neverhaveiever", "wouldyourather", "quiz"];

      if (!validGames.includes(game)) {
        return safeSend(
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
        return safeSend(chatId, "Belum ada pemain yang bergabung.");
      }

      if (msg.from.id !== rooms[chatId].hostId) {
        return safeSend(chatId, "⚠️ Hanya host yang bisa memulai game.");
      }

      if (rooms[chatId].players.length < 2) {
        return safeSend(chatId, "Minimal 2 pemain untuk memulai game.");
      }

      rooms[chatId].gameMode = game;
      rooms[chatId].started = true;
      rooms[chatId].currentTurn = 0;
      rooms[chatId].currentQuiz = null;
      rooms[chatId].activeNextMessageId = null;
      statsStore?.recordGameStart(game);

      const currentPlayer = rooms[chatId].players[0];

      safeSend(
        chatId,
        `🎮 GAME DIMULAI!

🎲 Mode:
${game}

🎯 Giliran pertama:
${currentPlayer.name}`
      );
    } catch (error) {
      console.error("/startgame handler error:", error.message || error);
    }
  });

  // =============================================
  // NEXT PLAYER COMMAND
  // =============================================

  bot.onText(/\/next/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId] || !rooms[chatId].started) {
        return safeSend(chatId, "Game belum dimulai.");
      }

      const activePlayer = getCurrentPlayer(rooms[chatId]);

      if (!activePlayer) {
        return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
      }

      if (msg.from.id !== activePlayer.id) {
        return safeSend(chatId, `⚠️ Sekarang giliran ${activePlayer.name}`);
      }

      rooms[chatId].currentTurn =
        (rooms[chatId].currentTurn + 1) % rooms[chatId].players.length;

      const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

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

      safeSend(
        chatId,
        `🎯 Giliran berikutnya:

${currentPlayer.name}

🎮 Mode: ${rooms[chatId].gameMode}

➡️ Ketik ${nextCommand}`
      );
    } catch (error) {
      console.error("/next handler error:", error.message || error);
    }
  });

  // =============================================
  // END GAME COMMAND
  // =============================================

  bot.onText(/\/endgame/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "⚠️ Belum ada room.");
      }

      if (msg.from.id !== rooms[chatId].hostId) {
        return safeSend(chatId, "❌ Hanya host yang dapat mengakhiri permainan.");
      }

      rooms[chatId].started = false;
      rooms[chatId].currentTurn = 0;
      rooms[chatId].gameMode = null;
      rooms[chatId].currentQuiz = null;
      rooms[chatId].activeNextMessageId = null;

      return showEndGameOptions(bot, chatId);
    } catch (error) {
      console.error("/endgame handler error:", error.message || error);
    }
  });

  // =============================================
  // LEAVE COMMAND
  // =============================================

  bot.onText(/\/leave/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return;
      }

      const { deleted, newHostId } = removePlayerFromRoom(rooms[chatId], msg.from.id);

      if (deleted) {
        delete rooms[chatId];
        return safeSend(
          chatId,
          `🔴 Room berhasil dibubarkan.

Terima kasih sudah bermain di YANTECH PARTY GAMES! 🎉

━━━━━━━━━━━━━━
👨‍💻 Created by @YanTechn0
💬 Kritik & Saran: @KritSarYanTechPartyGamesBot`
        );
      }

      if (newHostId) {
        const newHost = rooms[chatId].players.find((player) => player.id === newHostId);
        safeSend(chatId, `👑 Host baru: ${newHost?.name || "Tidak diketahui"}`);
      }

      safeSend(chatId, `❌ ${msg.from.first_name} keluar dari permainan.`);
    } catch (error) {
      console.error("/leave handler error:", error.message || error);
    }
  });

  // =============================================
  // SHUFFLE COMMAND
  // =============================================

  bot.onText(/\/shuffle/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId] || rooms[chatId].players.length < 2) {
        return safeSend(chatId, "Minimal 2 pemain.");
      }

      if (msg.from.id !== rooms[chatId].hostId) {
        return safeSend(chatId, "⚠️ Hanya host yang bisa mengacak urutan pemain.");
      }

      rooms[chatId].players.sort(() => Math.random() - 0.5);

      const list = rooms[chatId].players
        .map((player, index) => `${index + 1}. ${player.name}`)
        .join("\n");

      safeSend(chatId, `🔀 Urutan pemain berhasil diacak!\n\n${list}`);
    } catch (error) {
      console.error("/shuffle handler error:", error.message || error);
    }
  });

  // =============================================
  // HOST COMMAND
  // =============================================

  bot.onText(/\/host/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "Belum ada room.");
      }

      const host = rooms[chatId].players.find(
        (player) => player.id === rooms[chatId].hostId
      );

      safeSend(chatId, `👑 Host saat ini: ${host?.name || "Tidak ditemukan"}`);
    } catch (error) {
      console.error("/host handler error:", error.message || error);
    }
  });

  // =============================================
  // SCORE COMMAND
  // =============================================

  bot.onText(/\/score/, (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!rooms[chatId]) {
        return safeSend(chatId, "⚠️ Belum ada room.");
      }

      const ranking = [...rooms[chatId].players]
        .sort((a, b) => b.score - a.score)
        .map((player, index) => `${index + 1}. ${player.name} — ${player.score} poin`)
        .join("\n");

      safeSend(
        chatId,
        `🏆 LEADERBOARD

━━━━━━━━━━━━━━

${ranking}`
      );
    } catch (error) {
      console.error("/score handler error:", error.message || error);
    }
  });

  // =============================================
  // BUTTON HANDLER
  // =============================================

  bot.on("callback_query", async (query) => {
    const answerCallback = async (text, showAlert = false) => {
      try {
        await bot.answerCallbackQuery(query.id, text ? { text, show_alert: showAlert } : undefined);
      } catch (error) {
        console.warn("Callback query response failed:", error.message || error);
      }
    };

    try {
      const chatId = query.message?.chat?.id;
      const data = query.data;

      // Defensive: a callback with no message/chat (e.g. the original
      // message was deleted) or no payload can't be routed anywhere.
      if (!chatId || !data) {
        await answerCallback();
        return;
      }

      registerUserAndGroup(query.message?.chat, query.from.id);

      if (isDuplicateCallback(chatId, query, data)) {
        await answerCallback("⏳ Tunggu sebentar...");
        return;
      }

      // =========================
      // JOIN
      // =========================

      if (data === "join") {
        await answerCallback();

        if (!rooms[chatId]) {
          rooms[chatId] = createRoom(query.from.id);
        }

        if (rooms[chatId].started) {
          return safeSend(chatId, "⚠️ Game sudah dimulai, tidak bisa join sekarang.");
        }

        const playerExists = rooms[chatId].players.find(
          (player) => player.id === query.from.id
        );

        if (playerExists) {
          return safeSend(chatId, "⚠️ Kamu sudah bergabung.");
        }

        rooms[chatId].players.push({
          id: query.from.id,
          name: query.from.first_name,
          score: 0,
        });

        return safeSend(chatId, `✅ ${query.from.first_name} berhasil bergabung!`);
      }

      // =========================
      // PLAYERS
      // =========================

      if (data === "players") {
        await answerCallback();

        if (!rooms[chatId] || rooms[chatId].players.length === 0) {
          return safeSend(chatId, "Belum ada pemain.");
        }

        const list = rooms[chatId].players
          .map((p, i) => `${i + 1}. ${p.name}`)
          .join("\n");

        return safeSend(chatId, `📋 Daftar Pemain:\n\n${list}`);
      }

      // =========================
      // HELP
      // =========================

      if (data === "help") {
        await answerCallback();

        return safeSend(
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
          return safeSend(chatId, "⚠️ Belum ada room.");
        }

        const ranking = [...rooms[chatId].players]
          .sort((a, b) => b.score - a.score)
          .map((player, index) => `${index + 1}. ${player.name} — ${player.score} poin`)
          .join("\n");

        return safeSend(
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

        return safeSend(chatId, "🎮 Pilih Game", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎲 TOD", callback_data: "start_tod" }],
              [{ text: "🍻 NHIE", callback_data: "start_nhie" }],
              [{ text: "🤔 WYR", callback_data: "start_wyr" }],
              [{ text: "🧠 Quiz", callback_data: "start_quiz" }],
              [{ text: "🚪 Leave", callback_data: "leave_room" }],
              ...(isOwner(query.from.id) ? [[{ text: "📊 Stats", callback_data: "stats" }]] : []),
            ],
          },
        });
      }

      // =========================
      // START TOD
      // =========================

      if (data === "start_tod") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "Belum ada pemain yang bergabung.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("⚠️ Hanya host yang bisa memulai game.", true);
          return;
        }

        await answerCallback();

        if (rooms[chatId].players.length < 2) {
          return safeSend(chatId, "Minimal 2 pemain untuk memulai game.");
        }

        rooms[chatId].gameMode = "tod";
        rooms[chatId].started = true;
        rooms[chatId].currentTurn = 0;
        rooms[chatId].currentQuiz = null;
        rooms[chatId].activeNextMessageId = null;
        statsStore?.recordGameStart("tod");

        return safeSend(
          chatId,
          `🎮 GAME DIMULAI!

🎲 Mode: TOD

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🎲 Spin", callback_data: "spin" }]],
            },
          }
        );
      }

      // =========================
      // START NHIE
      // =========================

      if (data === "start_nhie") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "Belum ada pemain yang bergabung.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("⚠️ Hanya host yang bisa memulai game.", true);
          return;
        }

        await answerCallback();

        if (rooms[chatId].players.length < 2) {
          return safeSend(chatId, "Minimal 2 pemain untuk memulai game.");
        }

        rooms[chatId].gameMode = "neverhaveiever";
        rooms[chatId].started = true;
        rooms[chatId].currentTurn = 0;
        rooms[chatId].currentQuiz = null;
        rooms[chatId].activeNextMessageId = null;
        statsStore?.recordGameStart("neverhaveiever");

        return safeSend(
          chatId,
          `🎮 GAME DIMULAI!

🍻 Mode: NHIE

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "🍻 NHIE", callback_data: "nhie" }]],
            },
          }
        );
      }

      // =========================
      // START WYR
      // =========================

      if (data === "start_wyr") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "Belum ada pemain yang bergabung.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("⚠️ Hanya host yang bisa memulai game.", true);
          return;
        }

        await answerCallback();

        if (rooms[chatId].players.length < 2) {
          return safeSend(chatId, "Minimal 2 pemain untuk memulai game.");
        }

        rooms[chatId].gameMode = "wouldyourather";
        rooms[chatId].started = true;
        rooms[chatId].currentTurn = 0;
        rooms[chatId].currentQuiz = null;
        rooms[chatId].activeNextMessageId = null;
        statsStore?.recordGameStart("wouldyourather");

        return safeSend(
          chatId,
          `🎮 GAME DIMULAI!

🤔 Mode: WYR

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🤔 WYR", callback_data: "wyr" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );
      }

      // =========================
      // START QUIZ
      // =========================

      if (data === "start_quiz") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "Belum ada pemain yang bergabung.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("⚠️ Hanya host yang bisa memulai game.", true);
          return;
        }

        await answerCallback();

        if (rooms[chatId].players.length < 2) {
          return safeSend(chatId, "Minimal 2 pemain untuk memulai game.");
        }

        rooms[chatId].gameMode = "quiz";
        rooms[chatId].started = true;
        rooms[chatId].currentTurn = 0;
        rooms[chatId].currentQuiz = null;
        rooms[chatId].activeNextMessageId = null;
        statsStore?.recordGameStart("quiz");

        return safeSend(
          chatId,
          `🎮 GAME DIMULAI!

🧠 Mode: Quiz

🎯 Giliran pertama:
${rooms[chatId].players[0].name}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "🧠 Quiz", callback_data: "quiz" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
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
          return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
        }

        if (query.from.id !== currentPlayer.id) {
          return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
        }

        if (rooms[chatId].gameMode !== "tod") {
          return safeSend(chatId, "⚠️ Mode game saat ini bukan TOD.");
        }

        const truths = require("../data/truth.json");
        const dares = require("../data/dare.json");

        const isTruth = Math.random() < 0.5;
        const pool = isTruth ? truths : dares;
        const selectedQuestion = pickUnusedQuestion(rooms[chatId], isTruth ? "truth" : "dare", pool);
        const question = selectedQuestion?.item || (isTruth ? truths[0] : dares[0]);
        statsStore?.recordQuestion(isTruth ? "truth" : "dare");

        const mode = isTruth ? "❓ TRUTH" : "🔥 DARE";

        const spinMessage = await safeSend(
          chatId,
          `🎯 Giliran: ${currentPlayer.name}

🎲 Hasil Spin
━━━━━━━━━━━━━━

${mode}

${question}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "⏭ Next", callback_data: "next" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );

        // This is now the one and only valid "Next" button in the room.
        if (spinMessage && rooms[chatId]) {
          rooms[chatId].activeNextMessageId = spinMessage.message_id;
        }

        return;
      }

      // =========================
      // NHIE
      // =========================

      if (data === "nhie") {
        await answerCallback();

        const currentPlayer = getCurrentPlayer(rooms[chatId]);

        if (!currentPlayer) {
          return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
        }

        if (query.from.id !== currentPlayer.id) {
          return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
        }

        if (rooms[chatId].gameMode !== "neverhaveiever") {
          return safeSend(chatId, "⚠️ Mode game saat ini bukan NHIE.");
        }

        if (!rooms[chatId] || !rooms[chatId].started) {
          return safeSend(chatId, "Game belum dimulai.");
        }

        const nhie = require("../data/neverhaveiever.json");

        const selectedQuestion = pickUnusedQuestion(rooms[chatId], "neverhaveiever", nhie);
        const question = selectedQuestion?.item || nhie[0];
        statsStore?.recordQuestion("neverhaveiever");

        const nhieMessage = await safeSend(
          chatId,
          `🍻 NEVER HAVE I EVER

🎯 Giliran:
${currentPlayer.name}

${question}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "⏭ Next", callback_data: "next" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );

        if (nhieMessage && rooms[chatId]) {
          rooms[chatId].activeNextMessageId = nhieMessage.message_id;
        }

        return;
      }

      // =========================
      // WYR
      // =========================

      if (data === "wyr") {
        await answerCallback();

        const currentPlayer = getCurrentPlayer(rooms[chatId]);

        if (!currentPlayer) {
          return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
        }

        if (query.from.id !== currentPlayer.id) {
          return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
        }

        if (!rooms[chatId] || !rooms[chatId].started) {
          return safeSend(chatId, "Game belum dimulai.");
        }

        if (rooms[chatId].gameMode !== "wouldyourather") {
          return safeSend(chatId, "⚠️ Mode game saat ini bukan WYR.");
        }

        const wyr = require("../data/wouldyourather.json");

        const selectedQuestion = pickUnusedQuestion(rooms[chatId], "wouldyourather", wyr);
        const question = selectedQuestion?.item || wyr[0];
        statsStore?.recordQuestion("wouldyourather");

        const wyrMessage = await safeSend(
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
                [{ text: "⏭ Next", callback_data: "next" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );

        if (wyrMessage && rooms[chatId]) {
          rooms[chatId].activeNextMessageId = wyrMessage.message_id;
        }

        return;
      }

      // =========================
      // QUIZ
      // =========================

      if (data === "quiz") {
        await answerCallback();

        const currentPlayer = getCurrentPlayer(rooms[chatId]);

        if (!currentPlayer) {
          return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
        }

        if (query.from.id !== currentPlayer.id) {
          return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
        }

        if (!rooms[chatId] || !rooms[chatId].started) {
          return safeSend(chatId, "Game belum dimulai.");
        }

        if (rooms[chatId].gameMode !== "quiz") {
          return safeSend(chatId, "⚠️ Mode game saat ini bukan Quiz.");
        }

        if (rooms[chatId].currentQuiz) {
          return safeSend(chatId, "⚠️ Masih ada soal yang belum dijawab.");
        }

        const quizzes = require("../data/quiz.json");

        if (!Array.isArray(quizzes) || quizzes.length === 0) {
          return safeSend(chatId, "Data quiz belum tersedia.");
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
          return safeSend(chatId, "⚠️ Format data quiz salah.");
        }

        rooms[chatId].currentQuiz = {
          index: questionIndex,
          correctIndex: questionData.answer,
        };
        statsStore?.recordQuestion("quiz");

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
      }

      if (data.startsWith("quiz_answer_")) {
        await answerCallback();

        if (!rooms[chatId] || !rooms[chatId].started) {
          return safeSend(chatId, "Game belum dimulai.");
        }

        if (rooms[chatId].gameMode !== "quiz") {
          return safeSend(chatId, "⚠️ Mode game saat ini bukan Quiz.");
        }

        if (!rooms[chatId].currentQuiz) {
          return safeSend(chatId, "⚠️ Soal quiz belum aktif.");
        }

        const currentPlayer = rooms[chatId].players[rooms[chatId].currentTurn];

        if (!currentPlayer) {
          return safeSend(chatId, "⚠️ Player tidak ditemukan.");
        }

        // Only the player whose turn it is may answer their own question.
        if (query.from.id !== currentPlayer.id) {
          return safeSend(chatId, `⚠️ Sekarang giliran ${currentPlayer.name}`);
        }

        const selectedIndex = parseInt(data.replace("quiz_answer_", ""), 10);

        const quizzes = require("../data/quiz.json");
        const questionData = quizzes[rooms[chatId].currentQuiz.index];

        const isCorrect = selectedIndex === rooms[chatId].currentQuiz.correctIndex;

        if (isCorrect) {
          currentPlayer.score += 1;
        }

        rooms[chatId].currentQuiz = null;

        // Deactivate the answer buttons so this question can't be
        // answered twice (rapid taps / stale message).
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: query.message.message_id }
          );
        } catch (error) {
          console.warn("Failed to clear quiz keyboard:", error.message || error);
        }

        const answerResultMessage = await safeSend(
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
                [{ text: "⏭ Next", callback_data: "next" }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );

        if (answerResultMessage && rooms[chatId]) {
          rooms[chatId].activeNextMessageId = answerResultMessage.message_id;
        }

        return;
      }

      // =========================
      // NEXT
      // =========================

      if (data === "next") {
        // --- Validate BEFORE answering, so a rejection can be a real
        // alert popup instead of a silent ack + separate chat message. ---

        if (!rooms[chatId] || !rooms[chatId].started) {
          await answerCallback();
          return safeSend(chatId, "Game belum dimulai.");
        }

        const currentPlayer = getCurrentPlayer(rooms[chatId]);

        if (!currentPlayer) {
          await answerCallback();
          return safeSend(chatId, "⚠️ Tidak ada pemain yang aktif.");
        }

        // Requirement 1 & 2: only the current player may press Next;
        // anyone else gets a proper Telegram alert, not a chat message.
        if (query.from.id !== currentPlayer.id) {
          await answerCallback(`⚠️ Bukan giliranmu. Sekarang giliran ${currentPlayer.name}.`, true);
          return;
        }

        // Requirement 3, 4, 6 (root cause fix): each Next button is
        // single-use. We track the message_id of the one and only
        // currently-valid Next button on the room. Any click that
        // doesn't match it is either a stale button left over from an
        // earlier turn (e.g. re-pressed once it becomes this player's
        // turn again) or one that has already been consumed.
        const pressedMessageId = query.message?.message_id;
        const isValidToken =
          rooms[chatId].activeNextMessageId != null &&
          pressedMessageId === rooms[chatId].activeNextMessageId;

        if (!isValidToken) {
          await answerCallback("⚠️ Tombol ini sudah tidak berlaku.", true);
          // Best-effort: strip the leftover keyboard from this stale
          // message too, so it stops inviting further taps.
          if (pressedMessageId) {
            try {
              await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: pressedMessageId }
              );
            } catch (error) {
              console.warn("Failed to clear stale next keyboard:", error.message || error);
            }
          }
          return;
        }

        // Consume the token synchronously, before any `await`. This is
        // what makes it safe against several near-simultaneous "Next"
        // presses (requirement 5): whichever callback_query event is
        // processed first wins and immediately invalidates the token,
        // so any other event for the same button - however it arrives -
        // will fail the isValidToken check above and be rejected.
        rooms[chatId].activeNextMessageId = null;

        await answerCallback();

        // Requirement 3: immediately deactivate the button that was
        // just used so the exact same message can never trigger Next
        // again, successfully or not.
        try {
          await bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            { chat_id: chatId, message_id: pressedMessageId }
          );
        } catch (error) {
          console.warn("Failed to clear next keyboard:", error.message || error);
        }

        // Defensive re-check: the room could theoretically have been
        // dismissed by the host while we were awaiting Telegram above.
        if (!rooms[chatId]) {
          return;
        }

        rooms[chatId].currentTurn =
          (rooms[chatId].currentTurn + 1) % rooms[chatId].players.length;

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

        return safeSend(
          chatId,
          `🎯 Giliran berikutnya:\n\n${nextPlayer?.name || "Pemain berikutnya"}`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: buttonText, callback_data: callback }],
                [{ text: "🛑 End Game", callback_data: "endgame" }],
              ],
            },
          }
        );
      }

      // =========================
      // END GAME
      // =========================

      if (data === "endgame") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "⚠️ Belum ada room.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("❌ Hanya host yang dapat mengakhiri permainan.", true);
          return;
        }

        await answerCallback();

        rooms[chatId].started = false;
        rooms[chatId].currentTurn = 0;
        rooms[chatId].gameMode = null;
        rooms[chatId].currentQuiz = null;
        rooms[chatId].activeNextMessageId = null;

        return showEndGameOptions(bot, chatId);
      }

      // =========================
      // STATS
      // =========================

      if (data === "stats") {
        await answerCallback();

        if (!isOwner(query.from.id)) {
          return safeSend(chatId, "⚠️ Hanya owner yang dapat melihat statistik bot.");
        }

        const stats = statsStore?.get?.() || { users: [], groups: [], totalGames: 0, gameModes: {}, totalTruth: 0, totalDare: 0, totalNeverHaveIEver: 0, totalWouldYouRather: 0, totalQuiz: 0 };
        const gameModes = stats.gameModes || {};

        return safeSend(
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

      // =========================
      // DISMISS ROOM (CLOSE ROOM)
      // =========================

      if (data === "dismiss_room") {
        if (!rooms[chatId]) {
          await answerCallback();
          return safeSend(chatId, "⚠️ Belum ada room yang aktif.");
        }

        if (query.from.id !== rooms[chatId].hostId) {
          await answerCallback("❌ Hanya host yang dapat membubarkan room.", true);
          return;
        }

        await answerCallback();
        delete rooms[chatId];
        return safeSend(chatId, "🗑 Room berhasil dibubarkan.");
      }

      // =========================
      // LEAVE ROOM
      // =========================

      if (data === "leave_room") {
        await answerCallback();

        if (!rooms[chatId]) {
          return safeSend(chatId, "⚠️ Belum ada room yang aktif.");
        }

        const { deleted, newHostId } = removePlayerFromRoom(rooms[chatId], query.from.id);

        if (deleted) {
          delete rooms[chatId];
          return safeSend(chatId, "🚪 Kamu keluar. Room dibubarkan karena tidak ada pemain lagi.");
        }

        if (newHostId) {
          const newHost = rooms[chatId].players.find((player) => player.id === newHostId);
          safeSend(chatId, `👑 Host baru: ${newHost?.name || "Tidak diketahui"}`);
        }

        return safeSend(chatId, "🚪 Kamu keluar dari room.");
      }

      // Unknown / stale callback_data (e.g. from an old message after an
      // update) - acknowledge quietly so the button doesn't spin forever.
      await answerCallback();
    } catch (error) {
      console.error("callback_query handler error:", error.message || error);
      await answerCallback("⚠️ Terjadi kesalahan, silakan coba lagi.", true);
    }
  });
};
