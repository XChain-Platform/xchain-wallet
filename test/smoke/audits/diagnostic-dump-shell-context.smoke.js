// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §50 / Cluster L FOLLOWUP 4 smoke — diagnostic dump fills env / build /
// signers so support tickets carry shell + version + paired-device
// metadata.
//
// Asserts:
//   1. createBackgroundHost accepts a `getDiagnosticContext` dep and
//      threads its return into the diagnostic.dump handler.
//   2. The dump handler iterates vault.wallets to build the signers
//      list (id + vendor + model + firmwareVersion).
//   3. Each shell wires a getDiagnosticContext callback shaped per the
//      runtime it's running in:
//        - extension: shell:'extension', UA, manifest version
//        - web: shell:'web', UA
//        - desktop: shell:'desktop', Electron + Node versions, OS

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. createBackgroundHost accepts + uses getDiagnosticContext --------

const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(/getDiagnosticContext[\s\S]{0,40}?\.\.\.hostDeps/.test(hostSrc),
    'createBackgroundHost destructures getDiagnosticContext from deps');
assert.ok(
    /ctx = \(await getDiagnosticContext\?\.\(\)\) \|\| \{\}/.test(hostSrc),
    'diagnostic.dump awaits getDiagnosticContext() with optional-call',
);
assert.ok(
    /env: ctx\.env[\s\S]{0,80}?build: ctx\.build/.test(hostSrc),
    'dump call passes env + build through to diagnosticDump',
);

// --- 2. Signers iteration via vault.wallets ----------------------------

assert.ok(
    /const wallets = await vault\.wallets\.list\(\)[\s\S]{0,200}?listSignersForWallet\(vault, w\.id\)/.test(hostSrc),
    'dump handler iterates vault.wallets and pulls signer rows per wallet',
);
assert.ok(
    /signers\.push\(\{[\s\S]*?id: r\.id,[\s\S]*?vendor: r\.vendor,[\s\S]*?model: r\.model,[\s\S]*?firmwareVersion: r\.firmwareVersion \?\? null/.test(hostSrc),
    'dump handler shapes each signer row to { id, vendor, model, firmwareVersion }',
);

// --- 3. Shell-specific callbacks --------------------------------------

const extBg = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
    'utf8',
);
assert.ok(
    /getDiagnosticContext:\s*async\s*\(\)\s*=>\s*\(\{[\s\S]*?shell:\s*'extension'[\s\S]*?navigator\.userAgent/.test(extBg),
    'extension passes shell:extension + userAgent through getDiagnosticContext',
);
assert.ok(
    /chrome\.runtime\.getManifest\(\)\.version/.test(extBg),
    'extension passes the manifest version as the build.target',
);

const webHost = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'hostBridge.js'),
    'utf8',
);
assert.ok(
    /webDiagnosticContext\s*=\s*async\s*\(\)\s*=>\s*\(\{[\s\S]*?shell:\s*'web'/.test(webHost),
    'web hostBridge declares webDiagnosticContext with shell:web',
);
const webContextWires = (webHost.match(/getDiagnosticContext:\s*webDiagnosticContext/g) || []).length;
assert.equal(webContextWires, 3,
    'all three createBackgroundHost call sites in web hostBridge thread the callback');

const dskIndex = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'main', 'index.js'),
    'utf8',
);
assert.ok(
    /getDiagnosticContext:\s*async\s*\(\)\s*=>\s*\(\{[\s\S]*?shell:\s*'desktop'[\s\S]*?process\.versions\.electron/.test(dskIndex),
    'desktop main passes shell:desktop + Electron version through getDiagnosticContext',
);

// Runtime + messageHost forward the callback so the eventual
// createBackgroundHost call sees it.
const dskRuntime = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'main', 'runtime.js'),
    'utf8',
);
assert.ok(/getDiagnosticContext:\s*deps\.getDiagnosticContext/.test(dskRuntime),
    'desktop runtime persists getDiagnosticContext through createRuntime');
assert.ok(/getDiagnosticContext:\s*runtime\.getDiagnosticContext/.test(dskRuntime),
    'desktop runtime forwards the callback into createDesktopMessageHost');

console.log(
    'OK — diagnostic-dump-shell-context smoke (§50 / Cluster L FOLLOWUP 4 — getDiagnosticContext callback in createBackgroundHost; dump handler iterates vault.wallets to build signer rows; extension + web + desktop all wire shell-specific env + build payloads)',
);
