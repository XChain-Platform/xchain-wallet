// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-46 (dispenser low-escrow alert + one-tap refill).
//
// Asserts:
//   1. The watcher exists, is barrel-exported, and its settings flag is
//      schema-backed, v2-tolerant, and surfaced as a toggle.
//   2. All THREE shells construct, start and stop it.
//   3. Full auto-refill stays DEFERRED per the item: the watcher must notify
//      and deep-link, never sign or submit. This is the PC-16 consent line, so
//      it is worth pinning against a well-meaning future edit.
//   4. The alert is computed in dispenses (escrow / give_amount) off the action
//      detail, since the dispensers listing carries no remaining escrow.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notifications } from '../../../packages/core/src/index.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const read = (p) => readFileSync(p, 'utf8');

// 1: module + barrel + flag.
const watcherPath = join(core, 'src', 'notifications', 'DispenserEscrowWatcher.js');
assert.ok(existsSync(watcherPath), 'DispenserEscrowWatcher.js exists');
const src = read(watcherPath);
assert.equal(typeof notifications.DispenserEscrowWatcher, 'function', 'exported from the notifications barrel');

const settingsSrc = read(join(core, 'src', 'schemas', 'settings.js'));
assert.equal(createDefaultSettings().notifications.dispenserEscrow, true, 'the dispenserEscrow flag defaults ON');
assert.ok(
    /r\.notifications\.dispenserEscrow == null \|\| isBoolean\(r\.notifications\.dispenserEscrow\)/.test(settingsSrc),
    'the flag is v2-tolerant (older settings records predate it)',
);
assert.ok(
    /settings\.notifications\.dispenserEscrow !== false/.test(src),
    'the watcher reads the flag with an absent-means-on default',
);
assert.ok(
    /key: 'dispenserEscrow'/.test(read(join(core, 'src', 'shared', 'components', 'settings', 'NotificationsSection.jsx'))),
    'the flag has a Settings toggle',
);

// 2: every shell constructs, starts and stops it.
const SHELLS = [
    ['extension', join(wsRoot, 'packages', 'extension', 'src', 'background.js'), 'dispenserEscrowWatcher'],
    ['web', join(wsRoot, 'packages', 'web', 'src', 'hostBridge.js'), 'dispenserEscrowWatcher'],
    ['desktop', join(wsRoot, 'packages', 'desktop', 'main', 'runtime.js'), 'runtime.dispenserEscrowWatcher'],
];
for (const [shell, path, ref] of SHELLS) {
    const shellSrc = read(path);
    const r = ref.replace('.', '\\.');
    assert.ok(
        new RegExp(`${r} = new notificationsLib\\.DispenserEscrowWatcher\\(`).test(shellSrc),
        `${shell}: constructs the DispenserEscrowWatcher`,
    );
    assert.ok(new RegExp(`${r}\\.start\\(\\)`).test(shellSrc), `${shell}: starts it`);
    assert.ok(new RegExp(`${r}\\.stop\\(\\)`).test(shellSrc), `${shell}: stops it on lock`);
}

// 3: auto-refill stays deferred. This watcher notifies; it never spends.
for (const forbidden of ['submitAction', 'signAction', 'advancedAction', 'dispenserAction', 'sendToken', 'getSigner']) {
    assert.ok(
        !new RegExp(forbidden).test(src),
        `the watcher never calls ${forbidden}: full auto-refill is deferred (PC-16 consent concerns)`,
    );
}
assert.ok(
    /route: 'dispenser-detail'/.test(src) && /intent: 'refill'/.test(src),
    'it deep-links to PC-19\'s refill stage instead of acting',
);
assert.ok(
    /5\s*(\/\/\s*)?refills/.test(src) && /6,000\s*(\/\/\s*)?lifetime/.test(src),
    'the refill ceiling is documented where a future auto-refill author will read it',
);

// 4: dispenses, computed off the detail read.
assert.ok(
    /Math\.floor\(remaining \/ d\.giveAmount\)/.test(src),
    'the alert is measured in dispenses, not raw escrow',
);
assert.ok(
    /state\.give_remaining/.test(src) && /sdk\.getAction\(/.test(src),
    'remaining escrow comes from the action detail (the listing does not carry it)',
);
assert.ok(
    /MAX_DETAIL_READS_PER_TICK/.test(src) && /checking \$\{budget\.length\} this tick/.test(src),
    'the per-tick detail-read cap is bounded AND logged, never a silent truncation',
);
assert.ok(
    /actionIndex\}:\$\{d\.bucket\}/.test(src),
    'the notify-once key carries the bucket so low -> empty announces again',
);

console.log(
    'OK: dispenser escrow alert smoke (PC-46: barrel + v2-tolerant flag + toggle + 3-shell lifecycle + notify-not-spend + dispenses off the detail read)',
);
