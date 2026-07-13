// =============================================
// SHARED UTILITIES
// =============================================
// Centralizes logic that was previously duplicated (with slightly
// different implementations) across core.js, tod.js, neverhaveiever.js,
// wouldyourather.js and quiz.js. Behavior is preserved exactly, this
// just removes ~150 lines of copy-pasted drift risk.

// Maps a question "mode" to the room field that stores which indexes
// of that pool have already been used in the current cycle.
const STATE_KEY_MAP = {
  truth: "usedTruth",
  dare: "usedDare",
  neverhaveiever: "usedNHIE",
  wouldyourather: "usedWYR",
  quiz: "usedQuiz",
};

// Makes sure a room object has every used-question array initialized,
// regardless of when/how the room was created. Safe to call repeatedly.
const ensureUsedQuestionState = (room) => {
  if (!room) {
    return room;
  }

  if (!room.usedQuestions || typeof room.usedQuestions !== "object") {
    room.usedQuestions = {};
  }

  if (!Array.isArray(room.usedTruth)) room.usedTruth = [];
  if (!Array.isArray(room.usedDare)) room.usedDare = [];
  if (!Array.isArray(room.usedNHIE)) room.usedNHIE = [];
  if (!Array.isArray(room.usedWYR)) room.usedWYR = [];
  if (!Array.isArray(room.usedQuiz)) room.usedQuiz = [];

  return room;
};

// Fully resets every category's rotation history. Only intended for a
// brand-new room; starting/switching a game mode should NOT call this,
// otherwise unrelated categories lose their "no repeat" progress (see
// pickUnusedQuestion below, which already resets a single category on
// its own once it is actually exhausted).
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

// Picks a random question from `pool` that hasn't been used yet in the
// room's current cycle for `mode`. Once every question has been used,
// the cycle resets automatically and a fresh shuffle begins.
// Returns { item, index } or null if the pool is empty/invalid.
const pickUnusedQuestion = (room, mode, pool) => {
  if (!room || !Array.isArray(pool) || pool.length === 0) {
    return null;
  }

  ensureUsedQuestionState(room);

  const stateKey = STATE_KEY_MAP[mode];
  if (!stateKey) {
    return { item: pool[Math.floor(Math.random() * pool.length)], index: 0 };
  }

  if (!Array.isArray(room.usedQuestions[mode])) {
    room.usedQuestions[mode] = [];
  }

  // Cycle exhausted -> reshuffle: clear history for this category only.
  if (room[stateKey].length >= pool.length) {
    room[stateKey] = [];
    room.usedQuestions[mode] = [];
  }

  const availableIndexes = pool
    .map((_, index) => index)
    .filter((index) => !room[stateKey].includes(index));

  // Defensive fallback (should not normally trigger given the check above).
  if (availableIndexes.length === 0) {
    room[stateKey] = [];
    room.usedQuestions[mode] = [];
    const fallbackIndex = Math.floor(Math.random() * pool.length);
    return { item: pool[fallbackIndex], index: fallbackIndex };
  }

  const selectedIndex = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
  room[stateKey] = [...room[stateKey], selectedIndex];
  room.usedQuestions[mode] = [...room.usedQuestions[mode], selectedIndex];

  return { item: pool[selectedIndex], index: selectedIndex };
};

// Wraps bot.sendMessage so a Telegram API failure (network blip, bot
// blocked, message too old, etc.) is logged instead of becoming an
// unhandled promise rejection that could crash the whole process.
const createSafeSend = (bot) => (chatId, text, options) => {
  return bot.sendMessage(chatId, text, options).catch((error) => {
    console.error(`sendMessage failed for chat ${chatId}:`, error.message || error);
    return null;
  });
};

module.exports = {
  ensureUsedQuestionState,
  resetUsedQuestionState,
  pickUnusedQuestion,
  createSafeSend,
};
