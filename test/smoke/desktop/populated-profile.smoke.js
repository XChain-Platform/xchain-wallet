// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { metaPathFor } from '../../../packages/desktop/main/meta.js';
import { sessionKeyPathFor } from '../../../packages/desktop/main/keychain.js';
import {
    handleIpcMessage,
    tearDownHost,
} from '../../../packages/desktop/main/runtime.js';
import { vaultPathFor } from '../../../packages/desktop/main/storage.js';
import {
    buildProfileRuntime,
    PROFILE_HISTORY_CHAIN_ID,
    PROFILE_HISTORY_TXID,
    PROFILE_PASSWORD,
    PROFILE_SETTINGS,
    seedPopulatedProfile,
} from './_populated-profile.js';

const userDataDir = mkdtempSync(join(tmpdir(), 'xchain-profile-'));
let runtime;

try {
    await seedPopulatedProfile(userDataDir);
    assert.ok(existsSync(vaultPathFor(userDataDir)), 'seeder writes vault.bin');
    assert.ok(existsSync(metaPathFor(userDataDir)), 'seeder writes meta.json');
    assert.equal(
        existsSync(sessionKeyPathFor(userDataDir)),
        false,
        'seeder leaves the profile locked',
    );

    runtime = buildProfileRuntime(userDataDir);
    const fixtureSecret = PROFILE_PASSWORD;
    const rejected = await handleIpcMessage(runtime, {
        type: 'wallet.unlock',
        request: { password: 'wrong-password' },
    });
    assert.equal(rejected.ok, false, 'wrong password is rejected');

    const unlocked = await handleIpcMessage(runtime, {
        type: 'wallet.unlock',
        request: { password: fixtureSecret },
    });
    assert.equal(unlocked.ok, true, 'fixture password unlocks the seeded profile');

    const settings = await handleIpcMessage(runtime, { type: 'settings.get' });
    assert.equal(settings.ok, true, 'settings.get succeeds after unlock');
    assert.deepEqual(
        {
            theme: settings.result.theme,
            fiatCurrency: settings.result.fiatCurrency,
            autolockMinutes: settings.result.autolockMinutes,
        },
        PROFILE_SETTINGS,
        'non-default profile settings survive restart',
    );

    const history = await handleIpcMessage(runtime, {
        type: 'pendingTxs.forAddress',
        request: { chainId: PROFILE_HISTORY_CHAIN_ID },
    });
    assert.equal(history.ok, true, 'pendingTxs.forAddress succeeds after unlock');
    assert.deepEqual(
        history.result.map(({ txid, status }) => [txid, status]),
        [[PROFILE_HISTORY_TXID, 'broadcast']],
        'broadcast history survives restart',
    );
} finally {
    if (runtime) tearDownHost(runtime);
    rmSync(userDataDir, { recursive: true, force: true });
}

console.log('populated desktop profile smoke OK');
