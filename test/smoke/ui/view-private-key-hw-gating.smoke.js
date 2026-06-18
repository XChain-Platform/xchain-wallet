// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §17.7.2 / G026: ViewPrivateKey does not offer a reveal
// path for HW (Trezor/Ledger) or watch-only addresses. Both source
// kinds short-circuit to an informational panel that says "the key
// lives on your device" / "no key here", without prompting for a
// password. Cluster E Step 3 of 5.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const routes = join(core, 'src', 'shared', 'routes');

const vpkPath = join(routes, 'ViewPrivateKey.jsx');
assert.ok(existsSync(vpkPath), 'ViewPrivateKey.jsx exists');
const vpk = readFileSync(vpkPath, 'utf8');

// Source classifier maps HW kinds to a non-revealable kind.
assert.ok(/case 'trezor':\s*return\s*\{\s*kind:\s*'hardware'/.test(vpk),
    'classifySource maps trezor → kind: hardware');
assert.ok(/case 'ledger':\s*return\s*\{\s*kind:\s*'hardware'/.test(vpk),
    'classifySource maps ledger → kind: hardware');
assert.ok(/case 'watch-only':\s*return\s*\{\s*kind:\s*'watch-only'/.test(vpk),
    'classifySource maps watch-only → kind: watch-only');

// Hardware branch must short-circuit BEFORE the warning / password
// / reveal render-stage branches. Use the render-branch headers
// (`stage === 'warning'`, `(stage === 'password' || stage === 'submitting')`,
// `// stage === 'revealed'`). Those only appear once, in render order.
const hwBranch = /sourceInfo\.kind === 'hardware'/.exec(vpk);
const warningStage = /stage === 'warning'/.exec(vpk);
const passwordStage = /stage === 'password' \|\| stage === 'submitting'/.exec(vpk);
const revealStage = /\/\/ stage === 'revealed'/.exec(vpk);
assert.ok(hwBranch, 'ViewPrivateKey gates HW addresses with sourceInfo.kind === "hardware"');
assert.ok(warningStage, 'ViewPrivateKey has a warning render-branch');
assert.ok(passwordStage, 'ViewPrivateKey has a password render-branch');
assert.ok(revealStage, 'ViewPrivateKey has a revealed render-branch');
assert.ok(hwBranch.index < warningStage.index,
    'HW gating short-circuits before the warning render-branch');
assert.ok(hwBranch.index < passwordStage.index,
    'HW gating short-circuits before the password render-branch');
assert.ok(hwBranch.index < revealStage.index,
    'HW gating short-circuits before the revealed render-branch');

// Same for watch-only.
const watchBranch = /sourceInfo\.kind === 'watch-only'/.exec(vpk);
assert.ok(watchBranch, 'ViewPrivateKey gates watch-only addresses');
assert.ok(watchBranch.index < passwordStage.index,
    'Watch-only gating short-circuits before the password render-branch');

// HW info panel says the key lives on the device. No prompt to enter password.
assert.ok(/lives on your/.test(vpk),
    'HW panel explains the key lives on the device');

console.log('view-private-key-hw-gating smoke OK');
