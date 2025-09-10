const { Telegraf, Context } = require("telegraf");
const { isMainThread, workerData, parentPort, getEnvironmentData } = require("worker_threads");
const crypto = require("crypto");

if(isMainThread) throw new Error("Can't be used as a node.js script, used as a worker thread");

let db = getEnvironmentData("db");
const { token, name } = workerData;
if(!db.MINI_APP_URL || !db.VERIFICATION_IMAGE_URL || !db.VERIFIED_IMAGE_URL || !db.Workers || !db.Admins || !token || !name) throw new Error("Missing required worker data");

const UserPrivilege = {
    Admin: 2,
    Worker: 1,
    Unprivileged: 0
}

parentPort.on("message", (msg) => {
    if(msg.type != "verification") return;
    if(msg.data == undefined) return console.log("no msgdata");
    if(msg.data.type == undefined) return console.log("no type");
    if(msg.data.key == undefined) return console.log("no key");
    if(msg.data.data == undefined) return console.log("no data");
    
    return completeUserVerification(msg.data.type, msg.data.key, msg.data.data);
});

class UserVerificationInfoEntry {
    /**
     * @type {Date}
     */
    verificationTime;

    /**
     * @type {Context}
     */
    context;

    /**
     * @type {string}
     */
    userId;

    /**
     * @type {string}
     */
    channelId;

    /**
     * @type {string}
     */
    verificationKey;

    constructor(userId, channelId, ctx) {
        this.verificationTime = new Date(Date.now());
        this.verificationKey = generateVerificationKey();
        this.channelId = channelId;
        this.userId = userId;
        this.context = ctx;
    }
}

/**
 * User verification info pool
 * 
 * @type {Array<UserVerificationInfoEntry>}
 */
const userVerificationInfo = [];

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
 * Registers the user for the website verification
 * 
 * @param {string} userId
 * 
 * @returns {UserVerificationInfoEntry}
 */
function regiserUserForVerification(userId, channel, ctx) {
    deleteFromPendingList(userId, channel); // no duplicate
    const entry = new UserVerificationInfoEntry(userId, channel, ctx);
    userVerificationInfo.push(entry);

    console.log(`Registered user ${entry.userId} with the key ${entry.verificationKey.substring(0, 5)}... (${entry.verificationTime})`);
    return entry;
}

/**
 * Generates an user verification key for the http server to handle the user
 * 
 * @returns {string} 128 characters verification key
 */
function generateVerificationKey() {
    return crypto.randomBytes(64).toString('hex');
}

/**
 * Completes a user verification
 * 
 * @param {string} verificationType verification type ("msg" / "ins")
 * @param {string} verificationKey verification key (key/channel)
 * @param data localStorage Data
 * @param {string} ip incoming IP address
 */
async function completeUserVerification(verificationType, verificationKey, data) {
    if(verificationType == "msg") {
        const entry = userVerificationInfo.filter((d) => d.verificationKey == verificationKey)[0];
        if(entry == undefined) return;
        deleteFromPendingList(entry.userId, entry.channelId)
        
        parentPort.postMessage({
            type: "localstorage",
            data: {
                data: data,
                channel: entry.channelId
            }
        });
    
        entry.context.sendPhoto(db.VERIFIED_IMAGE_URL, {
            caption:
                "Verified, you can join the group using this temporary link:\n\n" +
                `https://t.me/+vzgTFZuDzq9hMTlk\n\n` +
                "This link is a one time use and will expire"
        }).catch(null);
    } else {
        parentPort.postMessage({
            type: "localstorage",
            data: {
                data: data,
                channel: verificationKey
            }
        });
    }
}

/**
 * Deletes an entry from a pending list and looks for duplicates
 * 
 * @param {string} userId 
 * @param {string} channelId 
 */
function deleteFromPendingList(userId, channelId) {
    const entries = userVerificationInfo.filter((d) => d.userId == userId && d.channelId == channelId);
    for(let i = 0; i < entries.length; i++) {
        userVerificationInfo.splice(userVerificationInfo.indexOf(entries[i]));
    }
}

async function initBot() {
    const bot = new Telegraf(token);
    bot.launch(async () => {
        bot.command("start", async (ctx) => {
            if(ctx.chat.type != 'private') return;
            if(ctx.args.length != 1) return;
            const channel = ctx.args[0];

            const entry = regiserUserForVerification(ctx.from.id, channel, ctx);

            const keyboard = {
                inline_keyboard: [
                    [{ text: 'VERIFY', web_app: { url: db.MINI_APP_URL + `/${entry.verificationKey}`} }]
                ]
            };

            await ctx.replyWithPhoto({ url: db.VERIFICATION_IMAGE_URL }, {
                caption:"<b>Verify you're human with Safeguard Portal</b>\n\n" +
                        "Click 'VERIFY' and complete captcha to gain entry - " +
                        "<a href=\"https://docs.safeguard.run/group-security/verification-issues\"><i>Not working?</i></a>",
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        });
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

async function reloadDatabase() {
    db = getEnvironmentData("db");
}

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

initBot();
setInterval(reloadDatabase, 1000);