// Boot guard — a CLASSIC script (not a module) on purpose, so it still runs
// when the module graph itself is what's broken.
//
// Every menu in this game is DOM built by `src/main.js` and its imports. If any
// part of that graph fails to load, the player gets a bare hillside: no menu, no
// title, no error — the worst failure mode there is, and the one that sent us
// hunting. Three ways it happens, all caught here:
//
//   1. file:// — browsers refuse to load ES modules from it (double-clicking
//      index.html instead of serving it).
//   2. A module 404s or fails to parse. This kills the graph before any of our
//      code runs, and the browser reports it only as a window 'error' event with
//      no useful detail — so we walk the import graph ourselves and name the file.
//   3. boot() rejects — main.js calls window.showBootError directly.

(() => {
  const esc = (s) => String(s).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));

  window.showBootError = (title, html) => {
    document.getElementById('boot-error-title').textContent = title;
    document.getElementById('boot-error-msg').innerHTML = html;
    document.getElementById('boot-error').classList.remove('hidden');
  };

  // Script/module load failures don't bubble — listen in the capture phase.
  const errors = [];
  addEventListener('error', (e) => {
    const src = e.target && e.target !== window ? (e.target.src || e.target.href) : '';
    errors.push(src ? 'could not load ' + esc(src) : esc(e.message || 'script error'));
  }, true);
  addEventListener('unhandledrejection', (e) => errors.push(esc(e.reason?.message || e.reason)));

  if (location.protocol === 'file:') {
    window.showBootError('Serve me over HTTP', [
      'Hill Runner is built from ES modules, which browsers block on <code>file://</code>.',
      'From this folder, run<br><code>python -m http.server 8000</code><br>then open <code>http://localhost:8000</code>',
    ].join('<br><br>'));
    return;
  }

  // Re-fetch the module graph the same way the browser did and report the first
  // file that doesn't come back — that's the one that killed the boot. Runs only
  // after a failed boot, so it costs a stalled player nothing.
  const findBrokenModules = async (entry) => {
    const broken = [];
    const seen = new Set();
    const walk = async (url) => {
      if (seen.has(url)) return;
      seen.add(url);
      let res;
      try {
        res = await fetch(url);
      } catch (e) {
        broken.push(url.replace(location.origin, '') + ' — network error');
        return;
      }
      if (!res.ok) {
        broken.push(url.replace(location.origin, '') + ' — HTTP ' + res.status);
        return;
      }
      const src = await res.text();
      for (const m of src.matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
        await walk(new URL(m[1], url).href);
      }
    };
    await walk(entry);
    return broken;
  };

  // main.js sets this once the menus are up.
  setTimeout(async () => {
    if (window.__hillRunnerBooted) return;

    const entry = new URL('src/main.js', location.href).href;
    const broken = await findBrokenModules(entry);

    let detail;
    if (broken.length) {
      detail = 'These files failed to load:<br><code>' + broken.map(esc).join('</code><br><code>') + '</code>';
    } else {
      // Every file fetches fine, yet the module graph still died. A browser
      // extension is the usual culprit: blockers filter by REQUEST TYPE, so
      // they kill a <script> while letting the fetch() above sail through —
      // which is what made this invisible when `AdManager.js` was blocked.
      // A dynamic import rejects with the real reason, so ask for it that way;
      // the cache-buster also sidesteps a poisoned cache entry, in which case
      // the game simply boots and no panel is needed.
      let real = '';
      try {
        await import(entry + '?retry=' + Date.now());
        if (window.__hillRunnerBooted) return; // recovered
      } catch (e) {
        real = esc(e?.message || e);
      }
      detail = [
        'Every game file downloads fine, but the browser refused to run them.',
        'A <b>browser extension (ad blocker / privacy blocker)</b> is the usual cause — it can block a game file by name. Try disabling it for <code>' + esc(location.host) + '</code>, or open the game in a private window with extensions off.',
        real ? 'Reason:<br><code>' + real + '</code>' : '',
      ].filter(Boolean).join('<br><br>');
    }

    window.showBootError('Failed to start', [
      detail,
      'Also worth trying: hard refresh (<b>Ctrl+Shift+R</b>)',
      'Serving <code>' + esc(location.href) + '</code>',
    ].join('<br><br>'));
  }, 4000);
})();
