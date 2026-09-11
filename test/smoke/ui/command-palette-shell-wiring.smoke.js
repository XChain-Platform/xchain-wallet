// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 command-palette shell wiring.
//
// The Playwright E2E suite drives the WEB shell only, so it cannot catch a
// regression that drops the palette from the extension popup or desktop
// renderer. This smoke pins the invariant in all three shells on semantic
// facts (import + hook call + mount + command source), NOT a fixed source
// window, so a copy edit near the wiring can't read as a lost feature.
//
// Asserts, per shell App:
//   - imports CommandPalette, useCommandPalette, buildCommands
//   - calls useCommandPalette({ enabled: ... }) so the Cmd/Ctrl+K listener
//     is installed and gated on the unlocked state
//   - mounts <CommandPalette ... commands={...}> with the palette open/close
//     state, so it actually renders
//   - builds its command list via buildCommands(...) (the shared catalogue)
// Plus visible triggers: web via AppHeader.onCommandPalette, desktop via
// LeftNav.onCommandPalette. The extension popup has no shared header/nav, so
// its palette is reachable by Cmd/Ctrl+K only (a visible popup trigger is a
// tracked follow-up); its wiring is still pinned above.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(wsRoot, p), 'utf8');

// --- core module files exist --------------------------------------------

const moduleDir = 'packages/core/src/shared/commandPalette';
for (const f of ['fuzzyMatch.js', 'commandRegistry.js', 'CommandPalette.jsx', 'CommandPalette.module.css', 'useCommandPalette.js']) {
    assert.ok(existsSync(join(wsRoot, moduleDir, f)), `${moduleDir}/${f} exists`);
}

// commandRegistry exports the builders the shells depend on.
const registrySrc = read(`${moduleDir}/commandRegistry.js`);
assert.ok(/export function buildCommands\b/.test(registrySrc), 'buildCommands is exported');
assert.ok(/export function contactsToCommands\b/.test(registrySrc), 'contactsToCommands is exported');
for (const fn of ['balancesToCommands', 'sitesToCommands', 'settingsSectionsToCommands', 'helpToCommands']) {
    assert.ok(new RegExp(`export function ${fn}\\b`).test(registrySrc), `${fn} is exported (entity search)`);
}

// --- every shell App mounts the palette ---------------------------------

const shells = {
    web: 'packages/web/src/App.jsx',
    'extension popup': 'packages/extension/src/popup/App.jsx',
    desktop: 'packages/desktop/renderer/App.jsx',
};

for (const [label, path] of Object.entries(shells)) {
    const src = read(path);
    assert.ok(
        /import\s*\{\s*CommandPalette\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/commandPalette\/CommandPalette\.jsx'/.test(src),
        `${label} App imports CommandPalette`,
    );
    assert.ok(
        /import\s*\{\s*useCommandPalette\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/commandPalette\/useCommandPalette\.js'/.test(src),
        `${label} App imports useCommandPalette`,
    );
    assert.ok(
        /import\s*\{[^}]*\bbuildCommands\b[^}]*\bcontactsToCommands\b[^}]*\}\s*from\s*'@xchain-wallet\/core\/shared\/commandPalette\/commandRegistry\.js'/.test(src),
        `${label} App imports buildCommands + contactsToCommands`,
    );
    // Hook installed and gated on unlocked so Cmd/Ctrl+K is inert while locked.
    assert.ok(
        /useCommandPalette\(\{\s*enabled:\s*status\.state === 'unlocked'/.test(src),
        `${label} App installs the Cmd/Ctrl+K listener gated on the unlocked state`,
    );
    // Command list assembled from the shared catalogue.
    assert.ok(/buildCommands\(/.test(src), `${label} App builds its command list via buildCommands`);
    // Palette actually mounted with open/close wired to the hook.
    assert.ok(
        /<CommandPalette\b[\s\S]{0,240}?open=\{palette\.open\}[\s\S]{0,240}?onClose=\{palette\.closePalette\}[\s\S]{0,240}?commands=\{paletteCommands\}/.test(src),
        `${label} App mounts <CommandPalette> wired to the hook state`,
    );
    // §33.3 free-form parsing wired: parseQuery built from parseFreeformCommands
    // with a composeSend that prefills + navigates to Send, and passed in.
    assert.ok(/parseFreeformCommands\(/.test(src),
        `${label} App builds free-form intents via parseFreeformCommands`);
    assert.ok(/composeSend:\s*\(\{\s*amount,\s*tick\s*\}\)\s*=>/.test(src),
        `${label} App supplies a composeSend handler for the "send N TICK" intent`);
    assert.ok(/parseQuery=\{paletteParseQuery\}/.test(src),
        `${label} App passes parseQuery into <CommandPalette>`);

    // §34 keyboard shortcuts: dispatcher installed (gated on unlocked + not
    // palette-open + not help-open) and the ShortcutHelp modal mounted.
    assert.ok(
        /import\s*\{\s*useKeyboardShortcuts\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/keyboard\/useKeyboardShortcuts\.js'/.test(src),
        `${label} App imports useKeyboardShortcuts`,
    );
    assert.ok(
        /useKeyboardShortcuts\(\{[\s\S]{0,240}?enabled:\s*status\.state === 'unlocked' && !palette\.open && !shortcutHelpOpen/.test(src),
        `${label} App installs the shortcut dispatcher gated on unlocked + !palette + !help`,
    );
    assert.ok(/<ShortcutHelp\b[\s\S]{0,120}?open=\{shortcutHelpOpen\}/.test(src),
        `${label} App mounts <ShortcutHelp> wired to shortcutHelpOpen`);

    // Txid/date queries offer a history search in every shell.
    assert.ok(/searchHistory:\s*\(query\)\s*=>/.test(src),
        `${label} App supplies a searchHistory handler for txid/date queries`);
    // §34.1: user overrides thread into the dispatcher + help modal.
    assert.ok(/overrides:\s*settings\?\.keyboard\?\.bindings/.test(src),
        `${label} App threads keyboard overrides into useKeyboardShortcuts`);
    assert.ok(/<ShortcutHelp\b[\s\S]{0,200}?overrides=\{settings\?\.keyboard\?\.bindings\}/.test(src),
        `${label} App threads keyboard overrides into ShortcutHelp`);
    assert.ok(/binding:\s*settings\?\.keyboard\?\.bindings\?\.\['command-palette'\]/.test(src),
        `${label} App threads the palette binding override into useCommandPalette`);
}

// --- entity search per shell --------------------------------------
// Tokens: every shell opens TokenDetail with the row ref (desktop gained the
// 'token-detail' route + Home onSelectToken in ).
for (const label of ['web', 'extension popup', 'desktop']) {
    const src = read(shells[label]);
    assert.ok(/balancesToCommands\(/.test(src), `${label} App folds token balances into the palette`);
    assert.ok(/openToken:\s*\(tok\)\s*=>\s*\{\s*setTokenDetailRef\(tok\);\s*setUnlockedView\('token-detail'\)/.test(src),
        `${label} App's openToken sets the full token ref and opens token-detail`);
}
// desktop parity: token-detail route mounted and Home rows clickable.
{
    const src = read(shells.desktop);
    assert.ok(/unlockedView === 'token-detail' && activeWalletId && tokenDetailRef/.test(src),
        'desktop App renders the token-detail route');
    assert.ok(/<TokenDetail\b/.test(src) && /import\s*\{\s*TokenDetail\s*\}\s*from\s*'@xchain-wallet\/core\/shared\/routes\/TokenDetail\.jsx'/.test(src),
        'desktop App imports and mounts the shared TokenDetail route');
    assert.ok(/onSelectToken=\{activeWalletId \? \(tok\) => \{\s*setTokenDetailRef\(tok\);\s*setUnlockedView\('token-detail'\);/.test(src),
        'desktop Home wires onSelectToken so balance rows open token-detail');
}

// Sites + settings deep-links + help topics: web + desktop (the popup has no
// Settings route, so it only gets the openHelp-backed help topic).
for (const label of ['web', 'desktop']) {
    const src = read(shells[label]);
    assert.ok(/sitesToCommands\(/.test(src), `${label} App folds connected sites into the palette`);
    assert.ok(/settingsSectionsToCommands\(/.test(src), `${label} App folds settings sections into the palette`);
    assert.ok(/setSettingsInitialSection\(/.test(src), `${label} App deep-links Settings via settingsInitialSection`);
    assert.ok(/initialSubpageId=\{settingsSubpage\}/.test(src), `${label} App passes the deep-link section into Settings`);
}
assert.ok(/helpToCommands\(/.test(read(shells['extension popup'])),
    'extension popup App folds help topics into the palette');
assert.ok(/onCommandPalette=\{palette\.openPalette\}/.test(read(shells['extension popup'])),
    'extension popup App wires the visible Home palette trigger');

// The popup trigger renders from TotalBalanceHero (threaded Home -> HomeTabs).
const hero = read('packages/core/src/shared/components/TotalBalanceHero.jsx');
assert.ok(/onCommandPalette\b/.test(hero) && /Open command palette/.test(hero),
    'TotalBalanceHero renders the popup\'s "Open command palette" search button');

// --- §34.1 rebinding + §34.2 context shortcuts ----------------------------

const shortcutsSrc = read('packages/core/src/shared/keyboard/shortcuts.js');
for (const fn of ['resolveBindings', 'isValidBinding', 'findBindingConflict', 'isRebindable']) {
    assert.ok(new RegExp(`export function ${fn}\\b`).test(shortcutsSrc), `shortcuts.js exports ${fn} (§34.1)`);
}
const settingsRoute = read('packages/core/src/shared/routes/Settings.jsx');
assert.ok(/id:\s*'keyboard'/.test(settingsRoute) && /KeyboardSection/.test(settingsRoute),
    'Settings registers the Keyboard rebinding section');
assert.ok(existsSync(join(wsRoot, 'packages/core/src/shared/components/settings/KeyboardSection.jsx')),
    'KeyboardSection component exists');

// Context shortcuts live in their routes via useScreenShortcuts.
assert.ok(existsSync(join(wsRoot, 'packages/core/src/shared/keyboard/useScreenShortcuts.js')),
    'useScreenShortcuts hook exists (§34.2)');
for (const [route, key] of [
    ['packages/core/src/shared/routes/History.jsx', 'e'],
    ['packages/core/src/shared/routes/Send.jsx', "'mod+enter'"],
    ['packages/core/src/shared/routes/Home.jsx', 'o'],
]) {
    const src = read(route);
    assert.ok(/useScreenShortcuts\(\{/.test(src), `${route} mounts useScreenShortcuts`);
    assert.ok(src.includes(key), `${route} binds its §34.2 key set`);
}

// --- visible triggers ----------------------------------------------------

const appHeader = read('packages/core/src/shared/components/AppHeader.jsx');
assert.ok(/onCommandPalette\b/.test(appHeader) && /Open command palette/.test(appHeader),
    'AppHeader renders an "Open command palette" search button (web + extension trigger)');

const leftNav = read('packages/core/src/shared/components/LeftNav.jsx');
assert.ok(/onCommandPalette\b/.test(leftNav) && /Open command palette/.test(leftNav),
    'LeftNav renders an "Open command palette" search row (desktop trigger)');

// web + extension pass the header trigger; desktop passes the nav trigger.
assert.ok(/onCommandPalette=\{palette\.openPalette\}/.test(read(shells.web)),
    'web App wires the AppHeader palette trigger');
assert.ok(/onCommandPalette=\{palette\.openPalette\}/.test(read(shells.desktop)),
    'desktop App wires the LeftNav palette trigger');

// --- destination parity: every navigate command lands somewhere ----------
//
// `buildCommands` emits its `go(view)` rows for every shell that mounts the
// catalogue, while each shell decides on its own which views it renders, so a
// destination no shell branch matches falls through to that shell's Home with
// no message. Assert the intersection instead of trusting it.
//
// Route sources are listed per shell because the web shell keeps its DEX
// routes in a swappable surface module (`surfaces/dex.jsx` when the DEX
// surface is compiled in, which is the same build in which the palette emits
// the DEX rows at all).
const shellRouteSources = {
    web: ['packages/web/src/App.jsx', 'packages/web/src/surfaces/dex.jsx'],
    'extension popup': ['packages/extension/src/popup/App.jsx'],
    desktop: ['packages/desktop/renderer/App.jsx'],
};
// Written exemptions only, one reason each. A destination added here is a
// decision that the row should not exist for that shell, not a way to quiet
// the check.
const destinationExemptions = {
    // Home is the fallthrough every shell renders when no branch matches, so
    // it has no `unlockedView === 'home'` branch anywhere by construction.
    home: 'the unmatched-view fallthrough in all three shells',
};

const paletteDestinations = [...new Set(
    [...registrySrc.matchAll(/run:\s*go\(\s*'([a-z0-9-]+)'\s*\)/g)].map((m) => m[1]),
)];
assert.ok(paletteDestinations.length >= 40,
    `buildCommands' go() destinations were extracted (${paletteDestinations.length} found)`);

for (const [label, paths] of Object.entries(shellRouteSources)) {
    const routeSrc = paths.map(read).join('\n');
    for (const dest of paletteDestinations) {
        if (destinationExemptions[dest]) continue;
        assert.ok(
            routeSrc.includes(`unlockedView === '${dest}'`),
            `${label} routes the palette destination '${dest}' (an unrouted destination bounces the user to Home silently)`,
        );
    }
}

// The gate that hid the desktop dead-end: a palette-reachable route must not
// be gated on a context ref the palette never sets. `controller-bind` carries
// the ADDRESS-scoped half of the form, which has no token subject at all.
for (const [label, paths] of Object.entries(shellRouteSources)) {
    const routeSrc = paths.map(read).join('\n');
    assert.ok(
        /unlockedView === 'controller-bind' && activeWalletId\)/.test(routeSrc),
        `${label} gates controller-bind on the wallet alone`,
    );
    assert.ok(
        !/unlockedView === 'controller-bind'[^)]*&& tokenDetailRef/.test(routeSrc),
        `${label} does not re-gate controller-bind on a token ref (D-153)`,
    );
}

console.log('OK: command-palette shell wiring (§33 + §34: core module present; web + extension popup + desktop each import, install the Cmd/Ctrl+K hook gated on unlocked, build commands, and mount <CommandPalette>; entity search + settings deep-links + popup trigger wired per shell; rebinding overrides threaded; §34.2 context shortcuts mounted in History/Send/Home; every buildCommands go() destination routed by every shell, controller-bind ungated in all three)');
