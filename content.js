/* Genshin Build Companion — content script for game8.co build pages.
   Extracts the build data the page already contains (tables are matched by
   their header TEXT, not class names, so CMS restyles don't break it) and
   renders a floating panel: build summary, team comps, farming checklist,
   calculator. All state stays in chrome.storage.local.
   v1.1 — names are read from link text OR img alt (game8 build/team cells
   use icon-only links where the name lives in the alt attribute). */
(function () {
  'use strict';
  if (window.__gbc) return;
  window.__gbc = true;

  /* ---------------- extraction ---------------- */

  function txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function tables() { return Array.prototype.slice.call(document.querySelectorAll('table')); }

  // game8 wraps many names in icon-only links: the visible text is empty and
  // the name sits in the img alt ("Genshin - Xilonen", "Verdict Image", ...)
  function cleanName(s) {
    return (s || '').replace(/^Genshin\s*[-–]\s*/i, '').replace(/\s+Image$/i, '').replace(/\s*×\s*[\d,]+\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function linkName(a) {
    var t = txt(a);
    if (t) return cleanName(t);
    var img = a.querySelector('img');
    return img ? cleanName(img.getAttribute('alt') || '') : '';
  }
  function cellLinks(cell) { return Array.prototype.slice.call(cell.querySelectorAll('a')); }

  function characterName() {
    var t = document.title || '';
    var m = t.match(/^(.+?)\s+Best Builds/i);
    if (m) return m[1].trim();
    var h1 = document.querySelector('h1');
    if (h1) return txt(h1).replace(/\s+Best Builds.*$/i, '');
    return location.pathname;
  }

  function characterInfo() {
    var info = { rarity: '', element: '', weaponType: '', rating: '' };
    tables().forEach(function (t) {
      var tx = txt(t);
      if (!/Rarity/.test(tx) || !/Element/.test(tx) || info.rarity) return;
      Array.prototype.forEach.call(t.rows, function (r) {
        if (r.cells.length < 2) return;
        var label = txt(r.cells[0]), val = txt(r.cells[r.cells.length - 1]);
        if (/^Rating$/i.test(label)) info.rating = val;
        else if (/^Rarity$/i.test(label)) info.rarity = (val.match(/★/g) || []).length + '★';
        else if (/^Element$/i.test(label)) info.element = val;
        else if (/^Weapon$/i.test(label)) info.weaponType = val;
      });
    });
    return info;
  }

  // game8 puts BOTH material sections in ONE table ("Ascension and Talent
  // Material Summary") — split it by rows at the talent header, or return
  // whole tables when a page uses two separate ones
  function materialTables() {
    var out = { ascension: null, talent: null, ascRows: null, talRows: null };
    tables().forEach(function (t) {
      var tx = txt(t);
      var hasAsc = /All Ascension Materials Needed/i.test(tx);
      var hasTal = /All Talent Materials Needed/i.test(tx);
      if (hasAsc && hasTal) {
        if (out.ascRows) return;
        var ascR = [], talR = [], cur = ascR;
        Array.prototype.forEach.call(t.rows, function (r) {
          var rtx = txt(r);
          if (/All Talent Materials Needed/i.test(rtx)) { cur = talR; return; }
          if (/All Ascension Materials Needed/i.test(rtx)) return;
          cur.push(r);
        });
        out.ascRows = ascR; out.talRows = talR;
      } else if (hasAsc && !out.ascension) out.ascension = t;
      else if (hasTal && !out.talent) out.talent = t;
    });
    return out;
  }

  function parseMaterials(container) {
    // container: a <table> or an array of <tr> rows (split combined table)
    var items = [], seen = {};
    if (!container) return items;
    var links = [];
    if (Array.isArray(container)) {
      container.forEach(function (r) {
        Array.prototype.forEach.call(r.querySelectorAll('a'), function (a) { links.push(a); });
      });
    } else {
      Array.prototype.forEach.call(container.querySelectorAll('a'), function (a) { links.push(a); });
    }
    // Names are links (text or icon w/ alt); the ×N count sits in the same
    // row/wrapper as the link
    links.forEach(function (a) {
      var name = linkName(a);
      if (!name || name.length > 90 || seen[name]) return;
      // walk up to the innermost ancestor that actually contains a ×N count —
      // the material's own wrapper, not the whole cell shared by all items
      var ctx = a.parentElement, depth = 0;
      while (ctx && ctx.tagName !== 'TR' && depth < 5 && !/×\s*[\d,]+/.test(txt(ctx))) { ctx = ctx.parentElement; depth++; }
      var m = ctx && ctx.tagName !== 'TABLE' ? txt(ctx).match(/×\s*([\d,]+)/) : null;
      if (!m) return;
      seen[name] = 1;
      items.push({ name: name, need: parseInt(m[1].replace(/,/g, ''), 10) });
    });
    // Fallback: no links matched — scrape "Name ×N" pairs from raw text
    if (!items.length) {
      var re = /([A-Za-z][A-Za-z0-9''()\- ]{2,70})\s*×\s*([\d,]+)/g, mm;
      var raw = Array.isArray(container)
        ? container.map(txt).join(' ')
        : txt(container);
      while ((mm = re.exec(raw))) {
        var n = mm[1].trim();
        if (!seen[n]) { seen[n] = 1; items.push({ name: n, need: parseInt(mm[2].replace(/,/g, ''), 10) }); }
      }
    }
    return items;
  }

  function numberedList(s) {
    return s.split(/\s*\d+\.\s*/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^\d+$/.test(x); });
  }

  // "Nighttime Whispers ×4  or  Golden Troupe ×2 + Archaic Petra ×2" —
  // groups are separated by <hr> inside the cell, pieces carry an "x4" suffix
  function parseArtifactsCell(cell) {
    var links = cellLinks(cell);
    if (!links.length) return '';
    if (links.some(function (a) { return !!txt(a); })) return ''; // text-name vintage: caller falls back to txt
    var groups = [[]], found = false;
    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT, null), node;
    while ((node = walker.nextNode())) {
      if (node.tagName === 'HR') { groups.push([]); }
      else if (node.tagName === 'A') {
        var nm = linkName(node);
        if (!nm) continue;
        var ctx = node.parentElement && node.parentElement !== cell ? txt(node.parentElement) : '';
        var mm = ctx.match(/x\s*(\d+)/i);
        groups[groups.length - 1].push(nm + (mm ? ' ×' + mm[1] : ''));
        found = true;
      }
    }
    if (!found) return '';
    return groups.map(function (g) { return g.join(' + '); })
      .filter(function (s) { return s; }).join('  or  ');
  }

  function parseReplacements(cell) {
    var names = cellLinks(cell).map(linkName).filter(function (x) { return x; });
    if (names.length) return names;
    return numberedList(txt(cell));
  }

  // "Sample Teams" cell: bold label ("Hyper:") followed by 4 character links,
  // groups separated by <hr>
  function parseSampleTeams(cell) {
    var teams = [], cur = null;
    function flush() { if (cur && cur.members.length) teams.push(cur); cur = null; }
    var walker = document.createTreeWalker(cell, NodeFilter.SHOW_ELEMENT, null), node;
    while ((node = walker.nextNode())) {
      if (node.tagName === 'B' || node.tagName === 'STRONG') {
        var label = txt(node).replace(/:$/, '').trim();
        if (label && label.length < 30 && !/^\d+\.?$/.test(label)) { flush(); cur = { name: label, members: [] }; }
      } else if (node.tagName === 'HR') {
        flush();
      } else if (node.tagName === 'A' && cur) {
        var nm = linkName(node);
        if (nm) cur.members.push(nm);
      }
    }
    flush();
    return teams;
  }

  function parseBuilds() {
    var builds = [];
    tables().forEach(function (t) {
      var tx = txt(t);
      if (!/Best Weapon/i.test(tx) || !/Best Artifacts/i.test(tx)) return;
      var b = { weapon: '', replacements: [], artifacts: '', mainStats: [], subStats: '', sampleTeams: [], heading: '' };
      // nearest preceding heading names the build (e.g. "Best Build", role variants)
      var n = t;
      while (n) {
        n = n.previousElementSibling || n.parentElement;
        if (!n || n === document.body) break;
        if (/^H[234]$/.test(n.tagName)) { b.heading = txt(n); break; }
        var h = n.querySelector && n.querySelector('h2, h3, h4');
        if (n.previousElementSibling == null && h) { b.heading = txt(h); break; }
      }
      Array.prototype.forEach.call(t.rows, function (r) {
        var label = r.cells.length >= 2 ? txt(r.cells[0]).replace(/:$/, '') : '';
        var cell = r.cells[r.cells.length - 1];
        var val = r.cells.length >= 2 ? txt(cell) : txt(r);
        var ms = val.match(/^(Sands|Goblet|Circlet)\s*:\s*(.+)$/i);
        if (ms) { b.mainStats.push({ slot: ms[1], value: ms[2] }); return; }
        if (/^Best Weapon$/i.test(label)) {
          var wl = cellLinks(cell);
          b.weapon = wl.length ? linkName(wl[0]) : val;
        }
        else if (/Replacement Weapons/i.test(label)) b.replacements = parseReplacements(cell);
        else if (/Best Artifacts/i.test(label)) b.artifacts = parseArtifactsCell(cell) || val;
        else if (/Artifact Sub Stats/i.test(label)) b.subStats = val;
        else if (/Sample Teams/i.test(label)) b.sampleTeams = parseSampleTeams(cell);
      });
      if (b.weapon || b.artifacts) builds.push(b);
    });
    return builds;
  }

  function parseTalentPriority() {
    var found = null;
    tables().forEach(function (t) {
      if (found) return;
      var tx = txt(t);
      if (!/1st/.test(tx) || !/2nd/.test(tx) || !/Elemental Skill/i.test(tx) || !/Sub-DPS/i.test(tx)) return;
      var roles = [], rows = [];
      Array.prototype.forEach.call(t.rows, function (r, i) {
        var cells = Array.prototype.map.call(r.cells, txt);
        if (i === 0) roles = cells.slice(1);
        else if (cells.length >= 2 && /^(1st|2nd|3rd)$/.test(cells[0])) rows.push({ rank: cells[0], values: cells.slice(1) });
      });
      if (roles.length && rows.length) found = { roles: roles, rows: rows };
    });
    return found;
  }

  function parseStatGoals() {
    var goals = [];
    tables().forEach(function (t) {
      if (goals.length) return;
      if (!/Goal Value/i.test(txt(t))) return;
      Array.prototype.forEach.call(t.rows, function (r) {
        if (r.cells.length < 2) return;
        if (r.cells[0].tagName === 'TH') return; // header row
        var stat = txt(r.cells[0]), goal = txt(r.cells[r.cells.length - 1]);
        if (!stat || !goal || /goal value/i.test(stat) || /goal value/i.test(goal)) return;
        var min = null, max = null, m;
        if ((m = goal.match(/([\d,.]+)\s*%?\s*~\s*([\d,.]+)/))) { min = parseFloat(m[1].replace(/,/g, '')); max = parseFloat(m[2].replace(/,/g, '')); }
        else if ((m = goal.match(/([\d,.]+)/))) { min = parseFloat(m[1].replace(/,/g, '')); }
        goals.push({ stat: stat, goal: goal, min: min, max: max });
      });
    });
    return goals;
  }

  /* ----- team comps ----- */

  function teamHeader(t) {
    if (!t.rows.length) return null;
    var raw = Array.prototype.map.call(t.rows[0].cells, function (c) { return txt(c); });
    var roleish = /^(main-?dps|sub-?dps|sub-?dpssupport|support|healer)$/i;
    var dps = 0, i;
    if (raw.length < 3) return null;
    for (i = 0; i < raw.length; i++) {
      var flat = raw[i].replace(/[\s/]+/g, '');
      if (!roleish.test(flat)) return null;
      if (/dps/i.test(flat)) dps++;
    }
    if (!dps) return null;
    return raw.map(function (r) { return r.replace(/\s*\/\s*/g, '/'); });
  }

  function teammateHeader(t) {
    if (!t.rows.length || t.rows[0].cells.length < 2) return false;
    return /^character$/i.test(txt(t.rows[0].cells[0])) && /explanation|notes?/i.test(txt(t.rows[0].cells[1]));
  }

  function parseTeamTable(t, headerDisplay) {
    var teams = [], carry = null, carryLeft = 0;
    Array.prototype.forEach.call(t.rows, function (r, ri) {
      if (ri === 0) return;
      var members = [], cells = r.cells, ci = 0, hi = 0;
      // first column may be rowspan'd across rows (the on-field carry)
      if (carryLeft > 0 && cells.length === headerDisplay.length - 1) {
        members.push(carry); carryLeft--; hi = 1;
      }
      for (; ci < cells.length && hi < headerDisplay.length; ci++, hi++) {
        var a = cells[ci].querySelector('a');
        var nm = (a ? linkName(a) : '') || txt(cells[ci]);
        if (!nm) continue;
        members.push({ name: nm, role: headerDisplay[hi] });
        if (ri === 1 && hi === 0 && cells[ci].rowSpan > 1) { carry = members[0]; carryLeft = cells[ci].rowSpan - 1; }
      }
      if (members.length >= 3) teams.push(members);
    });
    return teams;
  }

  function parseTeammates(t) {
    var out = [];
    Array.prototype.forEach.call(t.rows, function (r, ri) {
      if (ri === 0 || r.cells.length < 2) return;
      var a = r.cells[0].querySelector('a');
      var nm = (a ? linkName(a) : '') || txt(r.cells[0]);
      if (!nm) return;
      var c1 = r.cells[r.cells.length - 1];
      var roleEl = c1.querySelector('b, strong');
      var role = roleEl ? txt(roleEl) : '';
      var note = txt(c1);
      if (role && note.indexOf(role) === 0) note = note.slice(role.length).trim();
      if (note.length > 200) note = note.slice(0, 200).replace(/\s+\S*$/, '') + '…';
      out.push({ name: nm, role: role, note: note });
    });
    return out;
  }

  function parseTeams() {
    var res = { teams: [], teammates: [] };
    var h2s = document.querySelectorAll('h2'), h2 = null, i;
    for (i = 0; i < h2s.length; i++) {
      if (/best team comps?/i.test(txt(h2s[i]))) { h2 = h2s[i]; break; }
    }
    if (!h2) return res;
    // scope: siblings between this h2 and the next one
    var scope = [], n = h2.nextElementSibling;
    while (n && n.tagName !== 'H2') { scope.push(n); n = n.nextElementSibling; }
    var lastTeam = null;
    scope.forEach(function (elm) {
      var ts = [];
      if (elm.tagName === 'TABLE') ts.push(elm);
      else if (elm.querySelectorAll) Array.prototype.forEach.call(elm.querySelectorAll('table'), function (t) { ts.push(t); });
      ts.forEach(function (t) {
        var header = teamHeader(t);
        if (header) {
          parseTeamTable(t, header).forEach(function (members) {
            res.teams.push({ members: members, note: '' });
            lastTeam = res.teams[res.teams.length - 1];
          });
        } else if (!res.teammates.length && teammateHeader(t)) {
          res.teammates = parseTeammates(t);
        }
      });
      // the paragraph after a team table describes it
      if (elm.tagName === 'P' && lastTeam && !lastTeam.note) {
        var p = txt(elm);
        if (p.length > 30) lastTeam.note = p.length > 220 ? p.slice(0, 220).replace(/\s+\S*$/, '') + '…' : p;
      }
    });
    return res;
  }

  /* ---------------- data ---------------- */

  var mats = materialTables();
  var data = {
    char: characterName(),
    info: characterInfo(),
    builds: parseBuilds(),
    talent: parseTalentPriority(),
    goals: parseStatGoals(),
    teams: parseTeams(),
    ascMats: parseMaterials(mats.ascRows || mats.ascension),
    talMats: parseMaterials(mats.talRows || mats.talent)
  };

  // connect each team comp to the build (artifact set) whose sample roster it
  // matches best — that's the link the page itself implies inside build tables
  function linkTeamArtifacts() {
    if (!data.builds.length || !data.teams.teams.length) return;
    data.teams.teams.forEach(function (team) {
      var names = {};
      team.members.forEach(function (m) { names[m.name] = 1; });
      var best = null, bestShared = 0;
      data.builds.forEach(function (b) {
        (b.sampleTeams || []).forEach(function (st) {
          var shared = 0;
          st.members.forEach(function (n) { if (names[n]) shared++; });
          if (shared > bestShared) { bestShared = shared; best = b; }
        });
      });
      // 3 of 4 members shared = same core, otherwise leave it unlinked
      if (best && bestShared >= 3 && best.artifacts) {
        team.artifacts = best.artifacts;
        team.buildName = best.heading;
      }
    });
  }
  linkTeamArtifacts();

  var isBuildPage = data.builds.length > 0 || data.ascMats.length > 0 || data.teams.teams.length > 0;
  if (!isBuildPage) return; // not a character build page — stay invisible

  /* ---------------- state ---------------- */

  var KEY = 'gbc:' + data.char;
  var state = { have: {}, open: false, tab: 'build', build: 0 };
  var TABS = [['build', 'Build'], ['teams', 'Teams'], ['farm', 'Farm'], ['calc', 'Calc']];

  function storageGet(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(KEY, function (res) { cb(res && res[KEY] || {}); });
    } else { // file:// test harness
      try { cb(JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { cb({}); }
    }
  }
  function storageSet() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      var rec = {}; rec[KEY] = { have: state.have, open: state.open, tab: state.tab, build: state.build };
      chrome.storage.local.set(rec, function () {});
    } else {
      try { localStorage.setItem(KEY, JSON.stringify({ have: state.have, open: state.open, tab: state.tab, build: state.build })); } catch (e) {}
    }
  }
  function have(name) { return state.have[name] || 0; }
  function setHave(name, n) {
    n = Math.max(0, Math.min(n, 99999999));
    if (!n) delete state.have[name]; else state.have[name] = n;
    storageSet();
  }

  /* ---------------- calculator ---------------- */

  function fmt(n) { return n.toLocaleString('en-US'); }

  function calcEstimates() {
    // merge duplicates first (Mora appears in both sections) so entered
    // progress is subtracted from the total, not once per section
    var merged = [], byName = {};
    data.ascMats.concat(data.talMats).forEach(function (it) {
      if (byName[it.name]) byName[it.name].need += it.need;
      else { byName[it.name] = { name: it.name, need: it.need }; merged.push(byName[it.name]); }
    });
    var est = { mora: 0, bossRuns: 0, weeklyClears: 0, bookRuns: 0, resin: 0 };
    merged.forEach(function (it) {
      var rem = Math.max(0, it.need - have(it.name));
      if (!rem) return;
      if (it.name === 'Mora') {
        est.mora += rem;
      } else if (/^(Teachings|Guide|Philosophies)\b/i.test(it.name)) {
        // convert everything to Guide-equivalents (3 Teachings = 1 Guide, 3 Guides = 1 Philosophies)
        var eq = /Philosophies/.test(it.name) ? rem * 3 : (/Guide/.test(it.name) ? rem : rem / 3);
        est.bookRuns += eq / 4.4; // avg Guide-equivalents per 20-resin domain run
      } else if (it.need === 46 || (it.need >= 40 && it.need <= 50 && !/Topaz|Agate|Jade|Lazurite|Amethyst|Turquoise|Opal/i.test(it.name))) {
        est.bossRuns += rem / 2.55; // avg boss drops per 40-resin clear
      } else if (it.need === 18 && /String|Mirror|Bloom|Scale|Feather|Eye|Mudra|Gilded|Silk/i.test(it.name)) {
        est.weeklyClears += rem / 2.55;
      }
    });
    est.moraRuns = est.mora / 60000;               // Blossom of Wealth, 20 resin ≈ 60k
    est.resin = Math.round(est.moraRuns * 20 + est.bossRuns * 40 + est.bookRuns * 20);
    est.bookRuns = Math.ceil(est.bookRuns);
    est.bossRuns = Math.ceil(est.bossRuns);
    est.moraRuns = Math.ceil(est.moraRuns);
    est.weeklyClears = Math.ceil(est.weeklyClears);
    est.days = Math.ceil(est.resin / 180);
    return est;
  }

  /* ---------------- panel UI ---------------- */

  var root = document.createElement('div');
  root.id = 'gbc-root';
  document.documentElement.appendChild(root);

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function render() {
    root.innerHTML = '';

    // launcher
    var launcher = el('button', 'gbc-launcher' + (state.open ? ' gbc-hidden' : ''), '✦');
    launcher.title = 'Build Companion';
    launcher.addEventListener('click', function () { state.open = true; storageSet(); render(); });
    root.appendChild(launcher);
    if (!state.open) return;

    var panel = el('div', 'gbc-panel');

    // header
    var head = el('div', 'gbc-head');
    head.appendChild(el('div', 'gbc-title',
      '<div class="gbc-name">' + esc(data.char) + '</div>' +
      '<div class="gbc-meta mono">' + esc([data.info.rarity, data.info.element, data.info.weaponType].filter(Boolean).join(' · ')) + '</div>'));
    var close = el('button', 'gbc-close mono', '—');
    close.title = 'Minimize';
    close.addEventListener('click', function () { state.open = false; storageSet(); render(); });
    head.appendChild(close);
    panel.appendChild(head);

    // tabs
    var tabs = el('div', 'gbc-tabs mono');
    TABS.forEach(function (t) {
      var b = el('button', 'gbc-tab' + (state.tab === t[0] ? ' active' : ''), t[1]);
      b.addEventListener('click', function () { state.tab = t[0]; storageSet(); render(); });
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);

    var body = el('div', 'gbc-body');
    panel.appendChild(body);
    if (state.tab === 'build') renderBuild(body);
    else if (state.tab === 'teams') renderTeams(body);
    else if (state.tab === 'farm') renderFarm(body);
    else renderCalc(body);

    root.appendChild(panel);
  }

  function section(body, label) {
    var s = el('div', 'gbc-section');
    s.appendChild(el('div', 'gbc-label mono', esc(label)));
    body.appendChild(s);
    return s;
  }

  /* ----- Build tab ----- */
  function renderBuild(body) {
    if (!data.builds.length) {
      section(body, 'Build').appendChild(el('div', 'gbc-dim', 'No build tables found on this page.'));
    } else {
      if (data.builds.length > 1) {
        var pills = el('div', 'gbc-pills mono');
        data.builds.forEach(function (b, i) {
          var label = b.heading && b.heading.length < 40 ? b.heading : 'Build ' + (i + 1);
          var p = el('button', 'gbc-pill' + (state.build === i ? ' active' : ''), esc(label));
          p.addEventListener('click', function () { state.build = i; storageSet(); render(); });
          pills.appendChild(p);
        });
        body.appendChild(pills);
      }
      var b = data.builds[Math.min(state.build, data.builds.length - 1)];

      var w = section(body, 'Best weapon');
      w.appendChild(el('div', 'gbc-weapon', esc(b.weapon || '—')));
      if (b.replacements.length) {
        var rl = el('ol', 'gbc-list');
        b.replacements.forEach(function (r) { rl.appendChild(el('li', '', esc(r))); });
        w.appendChild(el('div', 'gbc-label mono gbc-mt', 'Replacements'));
        w.appendChild(rl);
      }

      var a = section(body, 'Artifacts');
      a.appendChild(el('div', 'gbc-art', esc(b.artifacts || '—')));
      if (b.mainStats.length) {
        var ms = el('div', 'gbc-kv mono');
        b.mainStats.forEach(function (m) {
          ms.appendChild(el('div', 'gbc-k', esc(m.slot)));
          ms.appendChild(el('div', 'gbc-v', esc(m.value)));
        });
        a.appendChild(ms);
      }
      if (b.subStats) {
        a.appendChild(el('div', 'gbc-label mono gbc-mt', 'Sub stats'));
        a.appendChild(el('div', 'gbc-dim', esc(b.subStats)));
      }

      if (b.sampleTeams && b.sampleTeams.length) {
        var st = section(body, 'Sample teams');
        var kv = el('div', 'gbc-kv mono');
        b.sampleTeams.forEach(function (tm) {
          kv.appendChild(el('div', 'gbc-k', esc(tm.name)));
          kv.appendChild(el('div', 'gbc-v', esc(tm.members.join(' · '))));
        });
        st.appendChild(kv);
      }
    }

    if (data.talent) {
      var t = section(body, 'Talent priority');
      var tbl = el('table', 'gbc-table mono');
      var hr = el('tr');
      hr.appendChild(el('th'));
      data.talent.roles.forEach(function (r) { hr.appendChild(el('th', '', esc(r))); });
      tbl.appendChild(hr);
      data.talent.rows.forEach(function (row) {
        var tr = el('tr');
        tr.appendChild(el('td', 'gbc-k', esc(row.rank)));
        row.values.forEach(function (v) { tr.appendChild(el('td', '', esc(v))); });
        tbl.appendChild(tr);
      });
      t.appendChild(tbl);
    }
  }

  /* ----- Teams tab ----- */
  function renderTeams(body) {
    var t = data.teams;
    if (!t.teams.length && !t.teammates.length) {
      section(body, 'Teams').appendChild(el('div', 'gbc-dim', 'No team comps found on this page.'));
      return;
    }
    if (t.teams.length) {
      var s = section(body, 'Team comps');
      t.teams.forEach(function (team, i) {
        var card = el('div', 'gbc-team');
        card.appendChild(el('div', 'gbc-teamname mono', 'Team ' + (i + 1)));
        team.members.forEach(function (m) {
          var row = el('div', 'gbc-member');
          row.appendChild(el('span', 'gbc-mname', esc(m.name)));
          row.appendChild(el('span', 'gbc-role mono', esc(m.role)));
          card.appendChild(row);
        });
        if (team.artifacts) {
          var ar = el('div', 'gbc-teamart');
          ar.appendChild(el('span', 'gbc-teamart-k mono', 'Artifacts'));
          ar.appendChild(el('span', 'gbc-teamart-v', esc(team.artifacts)));
          card.appendChild(ar);
        }
        if (team.note) card.appendChild(el('div', 'gbc-note', esc(team.note)));
        s.appendChild(card);
      });
    }
    if (t.teammates.length) {
      var s2 = section(body, 'Notable teammates');
      t.teammates.forEach(function (m) {
        var card = el('div', 'gbc-team');
        var row = el('div', 'gbc-member');
        row.appendChild(el('span', 'gbc-mname', esc(m.name)));
        row.appendChild(el('span', 'gbc-role mono', esc(m.role)));
        card.appendChild(row);
        if (m.note) card.appendChild(el('div', 'gbc-note', esc(m.note)));
        s2.appendChild(card);
      });
    }
  }

  /* ----- Farm tab ----- */
  function farmGroup(body, label, items) {
    if (!items.length) return;
    var s = section(body, label);
    var doneCount = 0;
    var list = el('div', 'gbc-mats');
    items.forEach(function (it) {
      var hv = have(it.name);
      var done = hv >= it.need;
      if (done) doneCount++;
      var row = el('div', 'gbc-mat' + (done ? ' done' : ''));
      var cb = el('input', 'gbc-cb');
      cb.type = 'checkbox';
      cb.checked = done;
      cb.addEventListener('change', function () {
        setHave(it.name, cb.checked ? it.need : 0);
        render();
      });
      row.appendChild(cb);
      row.appendChild(el('span', 'gbc-matname', esc(it.name)));
      var right = el('span', 'gbc-matnum mono');
      var input = el('input', 'gbc-have mono');
      input.type = 'number'; input.min = '0'; input.value = hv || '';
      input.placeholder = '0';
      input.addEventListener('change', function () {
        setHave(it.name, parseInt(input.value || '0', 10) || 0);
        render();
      });
      right.appendChild(input);
      right.appendChild(el('span', 'gbc-need', '/ ' + fmt(it.need)));
      row.appendChild(right);
      list.appendChild(row);
    });
    s.appendChild(list);
    var bar = el('div', 'gbc-progress');
    var pct = items.length ? Math.round(doneCount / items.length * 100) : 0;
    bar.appendChild(el('div', 'gbc-progress-fill'));
    bar.firstChild.style.width = pct + '%';
    s.appendChild(bar);
    s.appendChild(el('div', 'gbc-dim gbc-progress-label mono', doneCount + ' / ' + items.length + ' farmed'));
  }

  function renderFarm(body) {
    if (!data.ascMats.length && !data.talMats.length) {
      section(body, 'Materials').appendChild(el('div', 'gbc-dim', 'No material tables found on this page.'));
      return;
    }
    farmGroup(body, 'Ascension', data.ascMats);
    farmGroup(body, 'Talents', data.talMats);
    var reset = el('button', 'gbc-reset mono', 'Reset progress for ' + data.char);
    reset.addEventListener('click', function () {
      state.have = {}; storageSet(); render();
    });
    body.appendChild(reset);
  }

  /* ----- Calc tab ----- */
  function renderCalc(body) {
    var est = calcEstimates();

    var s = section(body, 'Still needed (after what you marked farmed)');
    var kv = el('div', 'gbc-kv mono');
    if (est.mora) { kv.appendChild(el('div', 'gbc-k', 'Mora')); kv.appendChild(el('div', 'gbc-v', fmt(est.mora) + ' ≈ ' + est.moraRuns + ' ley line runs')); }
    if (est.bossRuns) { kv.appendChild(el('div', 'gbc-k', 'World boss')); kv.appendChild(el('div', 'gbc-v', '≈ ' + est.bossRuns + ' runs (40 resin)')); }
    if (est.bookRuns) { kv.appendChild(el('div', 'gbc-k', 'Talent domain')); kv.appendChild(el('div', 'gbc-v', '≈ ' + est.bookRuns + ' runs (3 days/week)')); }
    if (est.weeklyClears) { kv.appendChild(el('div', 'gbc-k', 'Weekly boss')); kv.appendChild(el('div', 'gbc-v', '≈ ' + est.weeklyClears + ' weekly clears')); }
    if (!est.mora && !est.bossRuns && !est.bookRuns && !est.weeklyClears) {
      kv.appendChild(el('div', 'gbc-v', 'All tracked materials farmed — nice.'));
    }
    s.appendChild(kv);

    if (est.resin) {
      var r = section(body, 'Resin estimate');
      r.appendChild(el('div', 'gbc-resin', '≈ ' + fmt(est.resin) + ' resin'));
      r.appendChild(el('div', 'gbc-dim mono', '≈ ' + est.days + ' day' + (est.days > 1 ? 's' : '') + ' of a full 180-resin pool — boss gems drop from the same runs; weekly boss is time-gated separately.'));
    }

    if (data.goals.length) {
      var g = section(body, 'Stat goal check — enter your current stats');
      var grid = el('div', 'gbc-goals');
      data.goals.forEach(function (goal) {
        var row = el('div', 'gbc-goal');
        row.appendChild(el('span', 'gbc-k mono', esc(goal.stat)));
        var inp = el('input', 'gbc-have mono');
        inp.type = 'number'; inp.step = 'any'; inp.placeholder = '—';
        var verdict = el('span', 'gbc-verdict mono', '');
        function check() {
          var v = parseFloat(inp.value);
          if (isNaN(v) || goal.min == null) { verdict.textContent = goal.goal; verdict.className = 'gbc-verdict mono'; return; }
          var ok = v >= goal.min;
          verdict.textContent = ok ? '✓ ' + goal.goal : '✗ ' + goal.goal;
          verdict.className = 'gbc-verdict mono ' + (ok ? 'gbc-ok' : 'gbc-bad');
        }
        inp.addEventListener('input', check);
        row.appendChild(inp);
        row.appendChild(verdict);
        grid.appendChild(row);
      });
      g.appendChild(grid);
    }

    body.appendChild(el('div', 'gbc-dim gbc-foot mono',
      'Estimates assume 2.55 avg boss drops, 4.4 guide-equivalents per domain run, 60k Mora per ley line. Real luck varies.'));
  }

  /* ---------------- boot ---------------- */

  function boot() {
    storageGet(function (saved) {
      state.have = saved.have || {};
      state.open = !!saved.open;
      state.tab = saved.tab || 'build';
      state.build = saved.build || 0;
      render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
