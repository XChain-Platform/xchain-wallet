// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-45 (deadline watcher).
//
// Asserts:
//   1. The watcher exists, is exported from the notifications barrel, and its
//      settings flag is schema-backed and v2-tolerant.
//   2. All THREE shells construct it, start it, and stop it on lock - a
//      watcher wired in one shell only is the drift this pins.
//   3. Its scope boundary holds: COINPAY obligations (PC-15) and unstake
//      cooldowns (PC-47) own their timers, so this watcher must not query
//      them - it deep-links instead.
//   4. The two clocks stay separate: EXPIRATION against the chain's block
//      time, END_BLOCK against the chain tip height.

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

// 1: module + barrel + settings flag.
const watcherPath = join(core, 'src', 'notifications', 'DeadlineWatcher.js');
assert.ok(existsSync(watcherPath), 'DeadlineWatcher.js exists');
const src = read(watcherPath);
assert.equal(typeof notifications.DeadlineWatcher, 'function', 'DeadlineWatcher is exported from the notifications barrel');
assert.equal(typeof notifications.describeWindow, 'function', 'describeWindow is exported alongside it');

const settingsSrc = read(join(core, 'src', 'schemas', 'settings.js'));
assert.equal(createDefaultSettings().notifications.deadlines, true, 'the deadlines flag defaults ON');
assert.ok(
    /r\.notifications\.deadlines == null \|\| isBoolean\(r\.notifications\.deadlines\)/.test(settingsSrc),
    'the deadlines flag is v2-tolerant (older settings records predate it)',
);
assert.ok(
    /settings\.notifications\.deadlines !== false/.test(src),
    'the watcher reads the flag with an absent-means-on default',
);

// 2: every shell constructs, starts and stops it.
const SHELLS = [
    ['extension', join(wsRoot, 'packages', 'extension', 'src', 'background.js'), 'deadlineWatcher'],
    ['web', join(wsRoot, 'packages', 'web', 'src', 'hostBridge.js'), 'deadlineWatcher'],
    ['desktop', join(wsRoot, 'packages', 'desktop', 'main', 'runtime.js'), 'runtime.deadlineWatcher'],
];
for (const [shell, path, ref] of SHELLS) {
    const shellSrc = read(path);
    const r = ref.replace('.', '\\.');
    assert.ok(
        new RegExp(`${r} = new notificationsLib\\.DeadlineWatcher\\(`).test(shellSrc),
        `${shell}: constructs the DeadlineWatcher`,
    );
    assert.ok(new RegExp(`${r}\\.start\\(\\)`).test(shellSrc), `${shell}: starts it`);
    assert.ok(new RegExp(`${r}\\.stop\\(\\)`).test(shellSrc), `${shell}: stops it on lock`);
    assert.ok(
        new RegExp(`coinForChain: \\(chainId\\) => ${shell === 'desktop' ? 'runtime\\.' : ''}chainRegistry\\.get\\(chainId\\)`).test(shellSrc),
        `${shell}: injects the registry coin lookup (the block-interval conversion depends on it)`,
    );
}

// 3: the scope boundary with PC-15 and PC-47.
for (const forbidden of ['getCoinpay', 'coinpay_obligations', 'getUnstakes', 'cooldown']) {
    assert.ok(
        !new RegExp(`sdk\\.${forbidden}|${forbidden}\\(`).test(src),
        `the watcher does not duplicate the ${forbidden} timer (PC-15 / PC-47 own those)`,
    );
}
assert.ok(
    /ROUTE_BY_KIND/.test(src) && /route: ROUTE_BY_KIND\[d\.kind\]/.test(src),
    'notifications carry a deep-link route rather than restating another surface\'s countdown',
);

// 4: the two clocks.
assert.ok(
    /last_block_time/.test(src) && /chain_tip/.test(src),
    'the watcher reads BOTH the chain block time and the chain tip height',
);
assert.ok(
    !/Date\.now\(\)/.test(src),
    'an EXPIRATION is never judged against the local clock (the indexer settles on block time)',
);
assert.ok(
    /targetBlockSecondsForCoin/.test(src) && /windowBlocks/.test(src),
    'the poll lane converts the window into blocks at the coin interval instead of reusing seconds',
);
// The no-baseline decision is the deliberate difference from GovernancePollWatcher.
assert.ok(
    !/firstSight/.test(src),
    'no baseline tick: a deadline already near at startup is the case the feature exists for',
);

console.log(
    'OK: deadline watcher smoke (PC-45: barrel + v2-tolerant flag + 3-shell lifecycle + PC-15/PC-47 scope boundary + two clocks kept separate)',
);
