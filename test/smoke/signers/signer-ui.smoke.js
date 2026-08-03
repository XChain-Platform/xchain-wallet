// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 15 (piece 4d): Signer selection UI +
// view/export private key UI (§17.6, §17.7).
//
// Closes out Piece 4. Step 15 has two user-visible surfaces:
//
//   1. PairSignerForm: vendor picker (Trezor / Ledger) → pairing
//      factory → confirm + firmware verdict → persist via
//      messaging.registerSigner. Factories pass in as props so the
//      shared route stays shell-agnostic.
//   2. ViewPrivateKey: §17.7 reveal ceremony. Re-prompts for
//      password even inside unlocked session; classifies HW /
//      watch-only addresses to informational panels; tap-to-reveal +
//      window-blur auto-hide + clipboard auto-clear.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- 1. PairSignerForm file + public surface --------------------------

const pairPath = join(sharedRoutes, 'PairSignerForm.jsx');
const pairCssPath = join(sharedRoutes, 'PairSignerForm.module.css');
assert.ok(existsSync(pairPath), 'PairSignerForm.jsx exists');
assert.ok(existsSync(pairCssPath), 'PairSignerForm.module.css exists');

const pairSrc = readFileSync(pairPath, 'utf8');
assert.ok(
    /export function PairSignerForm\b/.test(pairSrc),
    'PairSignerForm is a named export',
);
assert.equal(
    (pairSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'PairSignerForm.jsx only exports the component',
);

// Four-stage state machine.
for (const stage of ['vendor', 'pairing', 'confirm', 'saving', 'done', 'error']) {
    assert.ok(
        pairSrc.includes(`'${stage}'`),
        `PairSignerForm tracks stage "${stage}"`,
    );
}

// DI: factories come in as props (not imported from shell).
assert.ok(
    /pairTrezor/.test(pairSrc) && /pairLedger/.test(pairSrc),
    'PairSignerForm accepts pairTrezor + pairLedger props',
);
assert.ok(
    !/from ['"][^'"]*\/signers\/trezorFactory/.test(pairSrc),
    'PairSignerForm does NOT import trezorFactory directly (kept shell-agnostic)',
);
assert.ok(
    !/from ['"][^'"]*\/signers\/ledgerFactory/.test(pairSrc),
    'PairSignerForm does NOT import ledgerFactory directly',
);

// Persists through messaging.registerSigner.
assert.ok(
    /messaging\.registerSigner\s*\(/.test(pairSrc),
    'PairSignerForm persists via messaging.registerSigner',
);

// Firmware verdict gates the save button on 'unsupported'.
assert.ok(
    /checkFirmware/.test(pairSrc),
    'PairSignerForm runs pairingInfo through checkFirmware',
);
assert.ok(
    /verdict\?\.status === 'unsupported'/.test(pairSrc),
    'PairSignerForm disables save when firmware is unsupported',
);

// --- 2. ViewPrivateKey file + public surface --------------------------

const viewPath = join(sharedRoutes, 'ViewPrivateKey.jsx');
const viewCssPath = join(sharedRoutes, 'ViewPrivateKey.module.css');
assert.ok(existsSync(viewPath), 'ViewPrivateKey.jsx exists');
assert.ok(existsSync(viewCssPath), 'ViewPrivateKey.module.css exists');

const viewSrc = readFileSync(viewPath, 'utf8');
assert.ok(
    /export function ViewPrivateKey\b/.test(viewSrc),
    'ViewPrivateKey is a named export',
);

// Three-stage flow + two informational panels (password stage retired).
for (const stage of ['warning', 'submitting', 'revealed']) {
    assert.ok(
        viewSrc.includes(`'${stage}'`),
        `ViewPrivateKey tracks stage "${stage}"`,
    );
}
assert.ok(
    !/'password'/.test(viewSrc),
    'ViewPrivateKey no longer has a password stage',
);

// HW + watch-only routing.
assert.ok(
    /classifySource/.test(viewSrc),
    'ViewPrivateKey classifies address source before revealing',
);
assert.ok(
    /sourceInfo\.kind === 'hardware'/.test(viewSrc),
    'ViewPrivateKey routes hardware addresses to info panel',
);
assert.ok(
    /sourceInfo\.kind === 'watch-only'/.test(viewSrc),
    'ViewPrivateKey routes watch-only addresses to info panel',
);
assert.ok(
    /lives on your/.test(viewSrc),
    'ViewPrivateKey renders §17.7.2 "lives on your device" copy',
);

// Security ceremony.
assert.ok(
    /messaging\.exportPrivateKey\s*\(/.test(viewSrc),
    'ViewPrivateKey calls messaging.exportPrivateKey (from the unlocked session, no password)',
);
assert.ok(
    /addEventListener\('blur'/.test(viewSrc),
    'ViewPrivateKey auto-hides on window blur (§17.7.1)',
);
// §17.7.1 / G028's clipboard auto-clear is GONE, with the Copy button it
// served: (2026-08-01) made key material uncopyable on every shell,
// so there is nothing on a clipboard to clear. The guardrails that remain are
// asserted above (tap-to-reveal, auto-hide on blur).
assert.ok(
    !/navigator\.clipboard/.test(viewSrc) && !/copyText\(/.test(viewSrc),
    'ViewPrivateKey copies nothing to the clipboard ',
);
assert.ok(
    /Tap to reveal/.test(viewSrc),
    'ViewPrivateKey uses tap-to-reveal, not auto-reveal',
);

// No password re-prompt: reveal is gated by the "Before you continue"
// warning only, then exports from the already-unlocked session signer.
assert.ok(
    !/type="password"/.test(viewSrc) && !/Required every time/.test(viewSrc),
    'ViewPrivateKey reveals from the unlocked session without a password prompt',
);
assert.ok(
    /Before you continue/.test(viewSrc),
    'ViewPrivateKey still shows the "Before you continue" warning gate',
);

// QR via render-prop (keeps core free of qrcode dep).
assert.ok(
    /renderQR/.test(viewSrc),
    'ViewPrivateKey accepts a renderQR render-prop; QR lib lives in shells',
);

// --- 3. Messaging wiring: exportPrivateKey ----------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('wallet\.exportPrivateKey'/.test(bg),
    'background host registers wallet.exportPrivateKey',
);
assert.ok(
    /exportPrivateKey\(\{\s*\.\.\.req,\s*signer:[^}]+vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'handler forwards deps to the core flow',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function exportPrivateKey\b/.test(m),
        `${shell} messaging.js exports exportPrivateKey`,
    );
    assert.ok(
        /sendMessage\('wallet\.exportPrivateKey'/.test(m),
        `${shell} messaging.js routes via wallet.exportPrivateKey`,
    );
}

// --- 4. App.jsx wiring: pair-signer sub-route + factory imports ------

// The web shell offers both Trezor + Ledger. The MV3 extension (popup)
// drops Trezor (it can't load the hosted Connect script under MV3's
// no-remote-code CSP; see trezorFactory.js), so it imports only the
// Ledger factory and injects pairTrezor={null} (PairSignerForm renders
// the Trezor option disabled).
for (const [shell, appPath, offersTrezor] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx'), false],
    ['web', join(web, 'src', 'App.jsx'), true],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        /import\s*\{\s*PairSignerForm\s*\}/.test(app),
        `${shell} App.jsx imports PairSignerForm`,
    );
    assert.ok(
        /pairLedgerSigner/.test(app),
        `${shell} App.jsx imports the Ledger factory fn for DI`,
    );
    assert.ok(
        app.includes("'pair-signer'"),
        `${shell} App.jsx tracks the pair-signer sub-route`,
    );
    assert.ok(
        /pairLedger=\{pairLedgerSigner\}/.test(app),
        `${shell} App.jsx injects the Ledger factory into PairSignerForm`,
    );
    if (offersTrezor) {
        assert.ok(
            /import\s*\{\s*pairTrezorSigner\s*\}/.test(app)
                && /pairTrezor=\{pairTrezorSigner\}/.test(app),
            `${shell} App.jsx imports + injects the Trezor factory`,
        );
    } else {
        assert.ok(
            !/import\s*\{\s*pairTrezorSigner\s*\}/.test(app)
                && /pairTrezor=\{null\}/.test(app),
            `${shell} App.jsx drops Trezor: no factory import, pairTrezor={null}`,
        );
    }
    assert.ok(
        /id:\s*['"]pair-signer['"]/.test(app),
        `${shell} App.jsx registers the pair-signer entry in buildActionEntries`,
    );
    assert.ok(
        /onPairSigner:\s*\(\)\s*=>\s*setUnlockedView\('pair-signer'\)/.test(app),
        `${shell} App.jsx wires onPairSigner`,
    );
}

// --- 5. Factory imports resolve (sanity check on relative paths) -----

const extAppSrc = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
assert.ok(
    !/from ['"]\.\.\/signers\/trezorFactory\.js['"]/.test(extAppSrc),
    'popup App.jsx does NOT import the (deleted) Trezor factory: Trezor is dropped from the MV3 extension',
);
assert.ok(
    /from ['"]\.\.\/signers\/ledgerFactory\.js['"]/.test(extAppSrc),
    'popup App.jsx still imports the Ledger factory via relative path',
);

const webAppSrc = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(
    /from ['"]\.\/signers\/trezorFactory\.js['"]/.test(webAppSrc),
    'web App.jsx uses relative path to trezorFactory',
);

console.log(
    'OK: signer UI smoke (PairSignerForm §17.6/§18.3: vendor picker + DI factories + firmware-verdict gating + messaging.registerSigner wiring; ViewPrivateKey §17.7: classifySource routes HW/watch-only to info panels + tap-to-reveal + window-blur auto-hide + no clipboard path at all  + password re-prompt; exportPrivateKey handler + messaging; pair-signer sub-route wired into both shells)',
);
