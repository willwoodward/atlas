# Atlas browser helper

Lets Atlas use a browser on your laptop: it finds trains, fills in booking
forms, and hands the page to you to check and pay. Irish Rail was the first
test case. Nothing here is specific to one site.

## How it stays safe

- **It connects out to Atlas.** It opens no ports, so nothing on the internet
  can reach your laptop through it.
- **It uses its own browser profile** in `~/.atlas-helper/profile`, with none
  of your normal cookies, passwords or saved cards. If you log in to a site
  during a handoff (Trainline, say), that login stays in this profile, so
  Atlas can use the account next time. Delete the folder to log out of
  everything.
- **Only the sites in your config open.** The list is checked here on the
  laptop, so the server can't widen it. Pages can't navigate the browser
  anywhere else.
- **Atlas can ask for another site, but only you can say yes.** A window opens
  on your laptop showing the site and Atlas's reason, with *Don't allow*,
  *Allow for now* and *Always allow*. The answer is read here and never goes
  through the server, so neither the server nor the model can grant itself
  access. It can ask at most 8 times per run, a "no" sticks until the helper
  restarts, and addresses, bare endings like `co.uk` and look-alike
  international names are never offered to you.
- **It never pays.** It refuses to type into card, bank or password fields and
  refuses to press pay or place-order buttons. Payment forms embedded from
  other sites (Stripe and the like) are invisible to Atlas.
- **A page you've been handed is yours.** Atlas can't touch it again.
- **Everything it does is logged** to `~/.atlas-helper/helper.log` (text it
  types is logged by length only).

These rules are in `src/policy.js`, and the tests in `test/` check them.

## Setup

1. On the server, add `BROWSER_HELPER_KEY` to `.env.production`
   (`openssl rand -hex 32`) and restart the api container.
2. Here:
   ```sh
   cd helper
   npm install
   npx playwright install chromium
   npm start            # first run creates ~/.atlas-helper/config.json
   ```
3. Put the key in `~/.atlas-helper/config.json`, check `sites`, and run
   `npm start` again. Settings → Assistant → Browser helper in Atlas shows
   it as connected.

## Config

```json
{
  "server": "https://willwoodward-clan-manager.duckdns.org",
  "key": "…",
  "sites": ["irishrail.ie", "thetrainline.com", "lner.co.uk"],
  "browser": { "visible": false, "channel": "", "executablePath": "" }
}
```

- **`sites`:** subdomains are included, so `irishrail.ie` also covers
  `booking.cf.irishrail.ie`. Restart the helper after changing the list.
  Sites you choose *Always allow* for are saved in
  `~/.atlas-helper/granted-sites.json`; delete a line there (and restart) to
  take one back. *Allow for now* lasts until the helper restarts.
- **`visible: true`:** the browser window stays on screen so you can watch
  Atlas work. With `false`, it's hidden and appears only when Atlas hands you
  a page.
- **`channel: "chrome"`:** uses your installed Chrome (still with the
  separate profile) instead of Playwright's Chromium.

## Running it in the background

- **Windows:** create a Task Scheduler task "At log on" that runs
  `node C:\path\to\helper\src\main.js`. A Windows install is best, because
  the handoff window then opens as a normal window.
- **WSL:** `npm start` works too, and windows appear through WSLg.

The browser itself closes after 10 minutes without use, to free memory.
Ctrl+C stops the helper.

## Tests

```sh
npm test    # set CHROMIUM_PATH to use a specific Chromium build
```
