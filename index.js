require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const rooms = {};

require("./commands/core")(bot, rooms);

require("./commands/tod")(bot, rooms);
require("./commands/neverhaveiever")(bot, rooms);
require("./commands/wouldyourather")(bot, rooms);

console.log("🤖 Bot aktif...");
setInterval(() => {}, 1000);