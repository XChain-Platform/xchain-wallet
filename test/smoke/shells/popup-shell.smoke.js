// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 2 piece 4 (extension popup HTML entry + React
// root + session-meta listener).
//
// Run with `node packages/core/test/popup-shell.smoke.js`.
//
// Two kinds of assertions:
//   1. Static: popup files exist, Vite config wires up React + the popup
//      entry + the icon-resize plugin, the manifest references the popup
//      + icons, and the App state machine covers the 5 router states.
//   2. Behavioural: stand up a fake chrome.runtime, install the session-
//      meta listener, and drive it through each of the three states
//      (no-wallet / locked / unlocked) by controlling what the two
//      storage backends return.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static surface -------------------------------------------------

const popupHtml = readFileSync(join(ext, 'popup.html'), 'utf8');
assert.ok(popupHtml.includes('id="xchain-popup-root"'), 'popup.html has root div');
assert.ok(
    /src=".\/src\/popup\/main\.jsx"/.test(popupHtml),
    'popup.html references src/popup/main.jsx',
);

const mainJsx = readFileSync(join(ext, 'src', 'popup', 'main.jsx'), 'utf8');
assert.ok(mainJsx.includes('createRoot'), 'main.jsx uses createRoot');
assert.ok(
    mainJsx.includes("'@xchain-wallet/core/ui/tokens.css'"),
    'main.jsx imports tokens.css',
);
assert.ok(mainJsx.includes('<App />'), 'main.jsx renders <App />');

const appJsx = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
for (const state of ['loading', 'error', 'no-wallet', 'locked', 'unlocked']) {
    assert.ok(
        appJsx.includes(`'${state}'`),
        `App.jsx state machine includes "${state}"`,
    );
}
assert.ok(appJsx.includes('getSessionStatus'), 'App.jsx queries getSessionStatus');

const messaging = readFileSync(join(ext, 'src', 'popup', 'messaging.js'), 'utf8');
assert.ok(
    /export\s+\{\s*sendMessage\b|export function sendMessage/.test(messaging),
    'messaging.js exports sendMessage (direct or re-export)',
);
assert.ok(
    /export function getSessionStatus/.test(messaging),
    'messaging.js exports getSessionStatus',
);
assert.ok(
    messaging.includes("'session.status'"),
    'messaging.js targets session.status',
);

// Every Phase-1 popup route (Loading / Onboarding / Locked / Create /
// Import / Home / Receive / Send) now lives in
// @xchain-wallet/core/shared/routes: the popup imports them from
// there and passes `shell="popup"` through MessagingProvider. The
// presence + wiring assertions live in shared-routes.smoke.js; the
// popup shell's contract here is just that its App.jsx pulls the
// shared routes + provider and its messaging.js exposes the pre-host
// helpers the background handlers consume.
const popupApp = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
for (const route of [
    'Loading', 'Onboarding', 'CreateWallet', 'ImportWallet',
    'Locked', 'Home', 'Receive', 'Send',
]) {
    assert.ok(
        popupApp.includes(`@xchain-wallet/core/shared/routes/${route}.jsx`),
        `popup App.jsx imports shared ${route}`,
    );
}
assert.ok(
    popupApp.includes('MessagingProvider') && popupApp.includes('shell="popup"'),
    'popup App.jsx wraps in <MessagingProvider shell="popup">',
);

// --- 2. Vite config ---------------------------------------------------

const viteCfg = readFileSync(join(ext, 'vite.config.js'), 'utf8');
assert.ok(
    /import react from '@vitejs\/plugin-react'/.test(viteCfg),
    'vite.config imports @vitejs/plugin-react',
);
assert.ok(/import sharp from 'sharp'/.test(viteCfg), 'vite.config imports sharp');
assert.ok(/react\(\)/.test(viteCfg), 'vite.config enables react plugin');
assert.ok(/popup: fileURLToPath/.test(viteCfg), 'vite.config declares popup entry');
assert.ok(
    /iconResizePlugin\(/.test(viteCfg),
    'vite.config invokes iconResizePlugin',
);
assert.ok(
    /sizes: \[16, 32, 48, 128\]/.test(viteCfg),
    'icon-resize emits all 4 MV3 sizes',
);

const extPkg = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
assert.ok(extPkg.devDependencies?.sharp, 'extension declares sharp devDep');
assert.ok(
    extPkg.devDependencies?.['@vitejs/plugin-react'],
    'extension declares @vitejs/plugin-react devDep',
);

// --- 3. Manifest ------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
assert.equal(manifest.action?.default_popup, 'popup.html');
for (const size of [16, 32, 48, 128]) {
    assert.equal(
        manifest.action?.default_icon?.[size],
        `icons/icon-${size}.png`,
        `action.default_icon ${size}`,
    );
    assert.equal(
        manifest.icons?.[size],
        `icons/icon-${size}.png`,
        `icons ${size}`,
    );
}

// --- 4. Background wiring --------------------------------------------

const bg = readFileSync(join(ext, 'src', 'background.js'), 'utf8');
assert.ok(
    bg.includes('attachSessionMetaListener'),
    'background.js attaches sessionMeta listener',
);

const bgIndex = readFileSync(
    join(ext, 'src', 'background', 'index.js'),
    'utf8',
);
assert.ok(
    bgIndex.includes('attachSessionMetaListener'),
    'background/index.js re-exports attachSessionMetaListener',
);

const adapter = readFileSync(
    join(ext, 'src', 'background', 'ChromeRuntimeAdapter.js'),
    'utf8',
);
assert.ok(
    adapter.includes('PRE_HOST_MESSAGE_TYPES.has('),
    'ChromeRuntimeAdapter defers pre-host message types to the meta listener',
);

// --- 5. Behavioural: session-meta listener drives 3 real states -------

const { attachSessionMetaListener } = await import(
    '../../../packages/extension/src/background/sessionMeta.js'
);

/**
 * Minimal fake for chrome.storage.local / chrome.storage.session.
 */
function makeFakeStorage(seed = {}) {
    let store = { ...seed };
    return {
        async get(key) {
            if (typeof key === 'string')
                return { [key]: store[key] };
            return { ...store };
        },
        async set(obj) { Object.assign(store, obj); },
        async remove(key) {
            if (Array.isArray(key)) for (const k of key) delete store[k];
            else delete store[key];
        },
        _setAll(next) { store = { ...next }; },
    };
}

function makeFakeRuntime() {
    const listeners = [];
    return {
        runtime: {
            onMessage: {
                addListener(fn) { listeners.push(fn); },
                removeListener(fn) {
                    const i = listeners.indexOf(fn);
                    if (i >= 0) listeners.splice(i, 1);
                },
            },
            lastError: null,
        },
        fire(message) {
            return new Promise((resolve) => {
                const done = (response) => resolve(response);
                let handled = false;
                for (const l of listeners) {
                    const r = l(message, {}, done);
                    if (r === true) { handled = true; break; }
                }
                if (!handled) resolve({ ok: false, error: { name: 'Unhandled', message: 'no listener' } });
            });
        },
    };
}

function withChromeStubs({ hasWallet, hasSession }, fn) {
    // Derive bytes from the feature flags. The meta listener only cares
    // that .load() returns non-null, so the exact bytes don't matter.
    // Keys must match the storage backends' DEFAULT_*_KEY constants.
    const localStore = hasWallet
        ? { 'xchain-wallet:vault': Buffer.from([1, 2, 3]).toString('base64') }
        : {};
    const sessionStore = hasSession
        ? { 'xchain-wallet:session': Buffer.from([9, 9, 9]).toString('base64') }
        : {};
    const stub = {
        storage: {
            local: makeFakeStorage(localStore),
            session: makeFakeStorage(sessionStore),
        },
    };
    const prev = globalThis.chrome;
    globalThis.chrome = stub;
    return Promise.resolve(fn()).finally(() => {
        globalThis.chrome = prev;
    });
}

async function probe(flags) {
    return withChromeStubs(flags, async () => {
        const fake = makeFakeRuntime();
        attachSessionMetaListener({}, fake.runtime);
        return fake.fire({ type: 'session.status' });
    });
}

{
    const r = await probe({ hasWallet: false, hasSession: false });
    assert.deepEqual(r, {
        ok: true,
        result: { hasWallet: false, hasSession: false, state: 'no-wallet' },
    });
}
{
    const r = await probe({ hasWallet: true, hasSession: false });
    assert.deepEqual(r, {
        ok: true,
        result: { hasWallet: true, hasSession: false, state: 'locked' },
    });
}
{
    const r = await probe({ hasWallet: true, hasSession: true });
    assert.deepEqual(r, {
        ok: true,
        result: { hasWallet: true, hasSession: true, state: 'unlocked' },
    });
}

// Non-session message must NOT be handled by the meta listener.
{
    await withChromeStubs({ hasWallet: false, hasSession: false }, async () => {
        const fake = makeFakeRuntime();
        attachSessionMetaListener({}, fake.runtime);
        const r = await fake.fire({ type: 'wallet.list' });
        assert.equal(r.ok, false, 'wallet.list is not handled by meta listener');
        assert.equal(r.error.name, 'Unhandled');
    });
}

console.log(
    'OK: popup shell smoke (13 static checks, Vite/manifest wiring, 3 session states + non-session passthrough)',
);
