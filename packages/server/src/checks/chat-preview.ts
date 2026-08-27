/**
 * Renders both chat densities to a standalone HTML file.
 *
 * Exists because the only other way to look at a chat overlay is to open
 * `/overlay/...` in a browser — which registers as a TTS listener and starts
 * talking through the speakers. This pulls the real stylesheet and the real
 * palette function into a static page instead, so colours and spacing can be
 * judged without a running server, a live audience, or any audio.
 *
 * Writes to `data/preview/chat.html`; open it directly in a browser.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BRAND_MARKS,
  DEFAULT_HIGHLIGHTS,
  nameColor,
  PLATFORM_INFO,
  tierStyle,
  type HighlightTier,
  type Platform,
} from '@streaming/shared';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const out = resolve(root, 'data/preview/chat.html');

// The stylesheet itself, so the preview cannot drift from what the overlay
// actually renders. Sliced from the chat block to the next section banner.
const sheet = readFileSync(resolve(root, 'packages/overlay/src/styles/overlay.css'), 'utf8');
const start = sheet.indexOf('.chat-widget {');
const css = sheet.slice(start, sheet.indexOf(' * Alerts', start) - 70);

type Row = { p: Platform; handle: string; name: string; text: string; mod?: boolean; sub?: boolean; kind?: string; tier?: string };
const rows: Row[] = [
  { p: 'youtube', handle: 'john_viewerson', name: 'john viewerson', text: 'Hello' },
  { p: 'tiktok', handle: 'flowery', name: 'flowery', text: 'the parkour section was insane' },
  { p: 'twitch', handle: 'calvifera', name: 'calvifera', text: 'testing the new overlay', mod: true },
  { p: 'tiktok', handle: 'cybercap', name: '𑣲⋆𝙘𝙮𝙗𝙚𝙧𝙘𝙖𝙥', text: 'w stream' },
  { p: 'youtube', handle: 'quietwatcher', name: '', text: 'first time here, this is sick' },
  { p: 'twitch', handle: 'nordvpnfan', name: 'NordVPNFan', text: 'what game is this', sub: true },
  { p: 'tiktok', handle: 'violent', name: 'ദ്ദി◝ ⩊ ◜.ᐟ violeₙt', text: 'sent 5x Rose', kind: 'gift' },
  { p: 'tiktok', handle: 'bigspender', name: 'BigSpender', text: 'sent 1x Galaxy', kind: 'gift', tier: 'tiktok-gifter' },
  { p: 'twitch', handle: 'subbedup', name: 'SubbedUp', text: 'been here since the start', sub: true, tier: 'twitch-sub' },
  { p: 'youtube', handle: 'supermember', name: 'SuperMember', text: 'take my money', tier: 'youtube-gifter' },
  { p: 'twitch', handle: 'zebra_22', name: 'zebra_22', text: 'followed the stream', kind: 'follow' },
  { p: 'youtube', handle: 'mkbee', name: 'mkbee', text: 'that jump scared me lol' },
  { p: 'tiktok', handle: 'bigmike', name: 'bigmike', text: 'yo' },
  { p: 'tiktok', handle: 'bigmike', name: 'bigmike', text: 'you should try the hard mode', kind: 'run' },
  { p: 'twitch', handle: 'katiek', name: 'katiek', text: 'chat is moving so fast today' },
];

const logo = (p: Platform): string => {
  const mark = BRAND_MARKS[p];
  if (!mark) return '';
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="${PLATFORM_INFO[p].color}" style="flex:none;display:block"><path d="${mark.path}"/></svg>`;
};

/** React's camelCase style object as a plain CSS declaration list. */
const inlineStyle = (style: Record<string, string>): string =>
  Object.entries(style)
    .map(([key, value]) => `${key.replace(/^Webkit/, 'webkit').replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^webkit/, '-webkit')}:${value}`)
    .join(';');

const badge = (r: Row): string => {
  const bits: string[] = [];
  if (r.mod) bits.push('MOD');
  if (r.sub) bits.push('SUB');
  if (!bits.length) return '';
  const info = PLATFORM_INFO[r.p];
  return `<span class="chat-badges">${bits.map((b) => `<span class="chat-badge" style="background:${info.color};color:${info.contrast}">${b}</span>`).join('')}</span>`;
};

const render = (density: string, withAvatar = true): string =>
  `<div class="chat-widget ${density}">` + rows.map((r) => {
    const run = r.kind === 'run' && density === 'chat-compact';
    const tier = r.tier ? DEFAULT_HIGHLIGHTS.find((t) => t.id === r.tier) : undefined;
    const nameStyle = tier ? inlineStyle(tierStyle(tier)) : `color:${nameColor(r.p, r.handle)}`;
    const cls = tier ? 'chat-name chat-name-tier' : 'chat-name';
    const head = run ? '' :
      `${badge(r)}<span class="${cls}" style="${nameStyle}">${r.name || r.handle}${r.kind && r.kind!=='run' ? '' : ':'}</span>`;
    return `<div class="chat-row">` +
      (withAvatar ? (run ? `<span class="chat-avatar chat-avatar-blank"></span>` : `<span class="chat-avatar chat-avatar-blank" style="background:linear-gradient(135deg,${nameColor(r.p,r.handle)},#0008)"></span>`) : '') +
      `<span class="chat-platform">${run ? '' : logo(r.p)}</span>` +
      `<div class="chat-body">${head}<span class="chat-text">${r.text}</span></div></div>`;
  }).join('') + `</div>`;

const html = `<!doctype html><meta charset="utf-8"><title>chat preview</title><style>
body{margin:0;font-family:'Inter','Segoe UI',system-ui,sans-serif;background:#1b2430;color:#fff}
.panes{display:flex;flex-direction:column;gap:0;width:430px}
.pane{flex:1;padding:14px;box-sizing:border-box;background-image:linear-gradient(135deg,#2d4a3e,#6b5b3a 45%,#8a6d5a);}
.pane h2{font:600 11px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;opacity:.7;margin:0 0 18px}
.stage{--font-family:'Inter';--font-size:20px;--font-weight:600;--text-color:#fff;--accent-color:#25f4ee;
--item-bg:rgba(10,10,16,.62);--radius:14px;--padding:12px;--gap:8px;--shadow:0 6px 24px rgba(0,0,0,.45);
--text-shadow:0 2px 6px rgba(0,0,0,.75);--text-stroke:2px #000;font-size:17px;font-weight:600}
.stage.comf{--gap:8px}
${css}
</style><div class="panes">
<div class="pane"><h2>Compact — merged</h2><div class="stage">${render('chat-compact')}</div></div>
<div class="pane"><h2>Comfortable — today</h2><div class="stage comf">${render('chat-comfortable')}</div></div>
</div>`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out}`);
