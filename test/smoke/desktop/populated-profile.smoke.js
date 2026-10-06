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
    PROFILE_SIGN_ADDRESS,
    PROFILE_PASSWORD,
    PROFILE_SETTINGS,
    seedPopulatedProfile,
} from './_populated-profile.js';

const suppliedProfileDir = process.env.XCHAIN_PROFILE_DIR;
const userDataDir = suppliedProfileDir
    ?? mkdtempSync(join(tmpdir(), 'xchain-profile-'));
let runtime;

try {
    if (suppliedProfileDir === undefined) {
        await seedPopulatedProfile(userDataDir);
    }
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

    const wallets = await handleIpcMessage(runtime, { type: 'wallet.list' });
    assert.equal(wallets.ok, true, 'wallet.list succeeds after unlock');
    const walletId = wallets.result[0].id;
    const activeAddresses = await handleIpcMessage(runtime, {
        type: 'addresses.active',
        request: { walletId },
    });
    assert.equal(activeAddresses.ok, true, 'addresses.active succeeds after unlock');
    const activeBitcoin = activeAddresses.result['bitcoin-mainnet'];
    assert.ok(activeBitcoin, 'bitcoin-mainnet has an active address');

    const balances = await handleIpcMessage(runtime, {
        type: 'balances.wallet',
        request: { walletId },
    });
    assert.equal(balances.ok, true, 'balances.wallet succeeds after unlock');
    const bitcoinBalance = balances.result['bitcoin-mainnet']
        .find(({ address }) => address === activeBitcoin.address);
    assert.deepEqual(
        bitcoinBalance.balances.native,
        { tick: 'BTC', quantity: '12345678', divisibility: 8 },
        'native balance survives restart',
    );

    const message = 'reopened profile signing check';
    const signed = await handleIpcMessage(runtime, {
        type: 'auth.signMessage',
        request: { walletId, addressId: activeBitcoin.id, message },
    });
    assert.equal(signed.ok, true, 'auth.signMessage succeeds without a password');
    const verification = runtime.sdkRegistry.get('bitcoin-mainnet').auth.verifyMessage(
        PROFILE_SIGN_ADDRESS,
        message,
        signed.result.signature,
    );
    assert.equal(verification.valid, true, 'signature matches the seeded profile mnemonic');
} finally {
    if (runtime) tearDownHost(runtime);
    if (suppliedProfileDir === undefined) {
        rmSync(userDataDir, { recursive: true, force: true });
    }
}

console.log('populated desktop profile smoke OK');
