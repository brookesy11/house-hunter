# House Hunter

A small installable web app (PWA) for house hunting: showing days and listing alerts.

- **Showings** tab: showing-day plans. The data file `data/showings.enc.json` is encrypted (AES-GCM, PBKDF2-SHA256 key) and is only decrypted on the owner's device after entering a passcode.
- **Alerts & New** tab: price drops, status changes and new listing matches (`data/alerts.json`, public listing info).

Plain static HTML/CSS/JS served by GitHub Pages. Open in Safari on iPhone, then Share → Add to Home Screen.
