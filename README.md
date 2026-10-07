# Stream Control

Read TikTok, Twitch and YouTube chat in one place, filter it, read it aloud, and
show it on stream. Everything runs on your own computer: no account, no hosted
service, no telemetry. It only talks to the platforms themselves.

```
TikTok  ─┐
Twitch  ─┼─▶ one chat ──▶ filters ──▶ rules ──▶ text-to-speech
YouTube ─┘                    │                      │
                              └───▶ overlays, dashboard, chat panel
```

## Set it up

**1. Install Node.js** (the free program this runs on). Get the **LTS** version
from <https://nodejs.org> and accept the default options.

**2. Download this project.** Click **Code → Download ZIP** on GitHub and unzip
it, or `git clone` it.

**3. Run setup.**

- **Windows:** double-click `setup.bat`.
- **Mac / Linux:** open a terminal in the folder and run `node scripts/setup.mjs`.

Setup installs everything, builds the dashboard, then asks about each platform.
**Press Enter to skip any question**; you can change it all later or re-run it
with `npm run setup`. At the end it offers to start the app and opens the
dashboard at <http://localhost:4700>.

Next time, start it with `npm start`.

### What setup asks

| Question | Why | Skip it and… |
| --- | --- | --- |
| TikTok @username | Which room to read | You type it on the dashboard instead |
| TikTok voices login | The TikTok TTS voices | Speech uses your browser's voices |
| Twitch channel | Which chat to join | Same |
| YouTube @handle or video link | Which stream to read | Same |
| Google TTS key | Best-sounding voices | Use TikTok or browser voices |

Reading chat needs no keys and you do not have to be the host.

**TikTok voices login.** Choose `b` and a browser window opens: log in to TikTok
there and setup picks up the login cookie by itself, then closes the window. It
uses a temporary profile, so your own browser is not touched, and nothing leaves
your computer. Choose `p` instead to paste it yourself: log in to tiktok.com,
press **F12 → Application → Cookies → https://www.tiktok.com** and copy the value
of `sessionid`. It is your login, so treat it like a password.

Every key lives in `data/secrets.json` and is also manageable on the dashboard's
**Keys** tab, which says which hosts each one is sent to. `npm run check:network`
fails if the code can reach a host that screen does not list.

### If the install fails

- `node` is not recognized: install Node.js (step 1), then **close and reopen**
  the terminal or folder.
- Errors about a package or version: delete the `node_modules` folder and run
  setup again. Check you have Node 20 or newer with `node -v`.
- The `npm audit` warnings some tools print are about developer-only tooling and
  do not affect running the app; installs here skip that report.

## Adding it to your streaming software

Each overlay in the dashboard has its own URL:

```
http://localhost:4700/overlay/<id>
```

Add it as a **browser source** (some apps call it a web page source) at the size
shown next to it. Copy buttons are on the **Go live** page.

| Type | What it does |
| --- | --- |
| `chat` | Live comments with avatars and badges |
| `alerts` | Cards for follows, gifts, subs and shares |
| `tts` | **The audio** — add this once and leave it open |
| `goal` | Progress bar toward a like, diamond or follower target |
| `leaderboard` | Top gifters, likers or chatters |
| `counter` | Viewers, likes, diamonds and other stats |
| `ticker` | Scrolling strip of recent events |
| `custom` | Your own HTML and CSS |

Add as many as you like, each with its own styling. Speech plays through the
`tts` source so it reaches your stream; with none open it plays from the
dashboard so you can test, and the dashboard tells you which is happening.

## Chat panel for gaming

A transparent, always-on-top window that shows the merged chat over your game
(run the game borderless-windowed). It needs the [Rust toolchain](https://rustup.rs):

```bash
npm run panel
```

`npm run panel:build` makes an installer; after that the dashboard's **Open chat
panel** button launches it. Opacity and text size are on the **Chat** tab.

## What it does

- **Filters.** Blocked words, phrases, regexes and users, censored or dropped.
  Matching sees through leetspeak, lookalike letters, other writing systems and
  mixed-script tricks. The **Filters** tab has a **Test a message** box.
- **People.** Trust regulars (they skip every gate), mute people from speech
  only, give individuals their own voice, and auto-penalize anyone who uses a
  disguised bypass to get something read aloud.
- **Speech rules.** Choose what is read, by whom and how: templates like
  `{{nickname}} says {{message}}`, gates (followers, subscribers, minimum gifts),
  prefix or regex conditions, priority and cooldowns. The **Log** tab explains
  why a message was *not* read.
- **Voices.** Google Cloud (recommended), TikTok, an unofficial Google engine, or
  browser speech. Details and setup are in [docs/tts.md](docs/tts.md).
- **Public URLs.** Add an ngrok token on the **Keys** tab to reach overlays from
  another machine. Set a tunnel login too: the tunnel exposes the dashboard.

## Updating

```bash
npm run update
```

Pulls, reinstalls if needed and rebuilds, stopping at the first failure. Your
settings are in `data/` and `.env`, which an update never touches, and new
settings appear with defaults. If you downloaded the ZIP, download it again over
the same folder and run `node scripts/setup.mjs`; your `data/` folder is kept.

## More

- [docs/tts.md](docs/tts.md): speech backends, TikTok TTS troubleshooting, voice list.
- [docs/development.md](docs/development.md): tests, project layout, notes on the TikTok integration.
- Advanced settings (port, dashboard password, keys in a file instead of the
  dashboard) are in [`.env.example`](.env.example).

## Not affiliated

Not affiliated with, endorsed by, or connected to TikTok, Twitch, Google or
YouTube. The TikTok connection uses reverse-engineered internal APIs, not a
public one: understand that before relying on it, and check the platform's terms
for your situation. See [docs/development.md](docs/development.md#a-note-on-the-tiktok-integration).

## License

MIT. See [LICENSE](LICENSE).
