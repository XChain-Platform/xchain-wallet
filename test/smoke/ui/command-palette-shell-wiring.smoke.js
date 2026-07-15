// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §33 command-palette shell wiring .
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
// tracked  follow-up); its wiring is still pinned above.

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

// commandRegistry exports the two builders the shells depend on.
const registrySrc = read(`${moduleDir}/commandRegistry.js`);
assert.ok(/export function buildCommands\b/.test(registrySrc), 'buildCommands is exported');
assert.ok(/export function contactsToCommands\b/.test(registrySrc), 'contactsToCommands is exported');

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

console.log('OK: command-palette shell wiring (§33 /: core module present; web + extension popup + desktop each import, install the Cmd/Ctrl+K hook gated on unlocked, build commands, and mount <CommandPalette>; AppHeader + LeftNav expose triggers)');
