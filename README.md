# Genshin Build Companion

A Chrome/Brave extension that turns game8's Genshin Impact character build guides
into a clean, persistent side panel: the build at a glance, team comps, a farming
checklist that remembers your progress, and a material/resin calculator — all
without leaving the page.

![Manifest V3](https://img.shields.io/badge/manifest-v3-blue)
![Chrome · Brave](https://img.shields.io/badge/chrome%20%C2%B7%20brave-supported-green)
![Data collection: none](https://img.shields.io/badge/data%20collection-none-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)

## Features

- **Build tab** — rarity/element/weapon, best weapon with ranked replacements, artifact sets (×4 and ×2/×2 mixes), Sands/Goblet/Circlet main stats, sub-stat priority, sample teams, and the talent priority table. Pages with multiple builds get a pill switcher
- **Teams tab** — every team comp from the guide, each member with their role and the guide's notes, plus the notable-teammates list. Teams that match a build's sample roster get that build's artifact set shown right on the card, so you know what to farm for the squad you're running
- **Farm tab** — every ascension and talent material with its needed count. Check items off or type exactly how many you have; progress bars track each group. Progress is saved per character and survives reloads
- **Calc tab** — what's left *after* what you've marked farmed: Mora (with ley-line runs), world-boss runs, talent-domain runs, weekly-boss clears, plus a total resin estimate and days-of-full-resin figure. A stat-goal checker compares your current ATK / CRIT / ER against the guide's recommended goals
- **Non-intrusive** — a small ✦ button in the corner; click to open, minimize anytime. The page itself is never modified

## Installation

### From the Chrome Web Store

> Coming soon — link lands here once the listing is approved.

### Manually (developer mode)

1. Download or clone this repo
2. Open `chrome://extensions` (or `brave://extensions`)
3. Enable **Developer mode** (top-right)
4. Click **Load unpacked** and select this folder
5. Visit any character build guide on game8, e.g. `game8.co/games/Genshin-Impact/archives/…`
6. Click the ✦ button in the bottom-right corner

## How it works

- **Text-anchored extraction** — tables are found by their header *text* ("Best Weapon", "All Ascension Materials Needed", "Goal Value"…), never by CSS classes, so game8 restyles that keep the labels won't break it. Names come from link text or icon `alt` attributes, and material counts from the innermost element containing the `×N` marker next to each item
- **Team ↔ artifact matching** — each build table carries "Sample Teams"; a team comp that shares 3 of 4 members with a build's sample roster inherits that build's artifact set on its card
- **Graceful activation** — the panel only appears on pages that actually contain build tables; other wiki pages are left untouched
- **Persistence** — progress lives in `chrome.storage.local`, keyed by character name
- **Calculator assumptions** (also printed in the panel): 2.55 average boss drops per 40-resin clear, ~4.4 guide-equivalents per talent-domain run (books converted 3:1 up the tiers), 60k Mora per 20-resin ley line, 180 resin/day. Weekly bosses are reported in clears since they're time-gated

## Permissions

| Permission | Why |
|---|---|
| `storage` | Remember farming progress, panel state, and active tab per character |
| Host access to `game8.co` | Read the build tables on guide pages (content script scoped to `https://game8.co/games/Genshin-Impact/archives/*`; no other site is touched) |

No remote code, no analytics, no accounts — everything runs on-device and nothing is uploaded anywhere.

## Project structure

```
Genshin-Build-Companion/
├── manifest.json     # MV3 manifest — content script scoped to game8 build pages
├── content.js        # extractor + panel UI + calculator (single file, no dependencies)
├── panel.css         # panel styles (all classes prefixed .gbc-)
├── icons/            # extension icons (16 / 48 / 128 px)
└── docs/             # screenshots for this README
```

## License

MIT. Not affiliated with HoYoverse, Cognosphere, or game8.
Genshin Impact is a trademark of HoYoverse.
