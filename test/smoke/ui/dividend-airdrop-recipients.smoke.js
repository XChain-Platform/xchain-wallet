// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §31.4 / Cluster O FOLLOWUP 2: DIVIDEND / AIRDROP recipient
// resolution + Save-N-as-one-contact UI in History.
//
// Pins:
//   1. flows/recipientsByAction.js exports getDividendRecipients +
//      getAirdropRecipients with the documented signatures and the
//      pre-resolved-tick / pre-resolved-listActionIndex shortcut paths.
//   2. Behavioral round-trip via in-memory SDK stubs:
//      - DIVIDEND: holders fetch normalizes various holder shapes,
//        excludes the action source, dedupes addresses.
//      - AIRDROP: list fetch reads ITEM array, accepts string + object
//        member shapes, dedupes.
//   3. createBackgroundHost destructures both flows + registers
//      history.{getDividendRecipients,getAirdropRecipients} routes.
//   4. Three messaging shells expose getDividendRecipients +
//      getAirdropRecipients shims.
//   5. History.jsx mounts <RecipientsBlock> after <SaveContactPrompt>
//      and consumes both messaging shims.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    getDividendRecipients,
    getAirdropRecipients,
} from '../../../packages/core/src/flows/recipientsByAction.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// ─── 1. flow shape ──────────────────────────────────────────────────────

const flowPath = join(wsRoot, 'packages/core/src/flows/recipientsByAction.js');
assert.ok(existsSync(flowPath), 'flows/recipientsByAction.js exists');
const flowSrc = readFileSync(flowPath, 'utf8');
assert.match(flowSrc, /export async function getDividendRecipients/, 'getDividendRecipients exported');
assert.match(flowSrc, /export async function getAirdropRecipients/, 'getAirdropRecipients exported');

const flowsIndex = readFileSync(join(wsRoot, 'packages/core/src/flows/index.js'), 'utf8');
assert.match(flowsIndex, /getDividendRecipients[\s\S]+?getAirdropRecipients[\s\S]+?from '\.\/recipientsByAction\.js'/,
    'flows/index.js re-exports both');

// ─── 2. Behavioral DIVIDEND round-trip ──────────────────────────────────

function makeSdkRegistry({ holders, action, list }) {
    return {
        get(_chainId) {
            return {
                async getHolders(_tick) { return holders; },
                async getAction(idx) {
                    if (action && idx === action.actionIndex) return action;
                    if (list && idx === list.actionIndex) return list;
                    return null;
                },
            };
        },
    };
}

// Pre-resolved tick: skips getAction.
{
    const sdkRegistry = makeSdkRegistry({
        holders: [
            { address: 'addr-A', balance: 100 },
            { address: 'addr-B', balance: 50 },
            { address: 'addr-A', balance: 999 }, // dup; should be deduped
        ],
    });
    const r = await getDividendRecipients({
        sdkRegistry, chainId: 'bitcoin-regtest', tick: 'XCP',
    });
    assert.equal(r.tick, 'XCP', 'tick echoed');
    assert.equal(r.recipients.length, 2, 'duplicate address deduped');
    assert.equal(r.recipients[0].address, 'addr-A');
    assert.equal(r.recipients[0].balance, '100');
    assert.equal(typeof r.snapshotNote, 'string', 'snapshotNote present');
}

// Action lookup path: pulls TICK + SOURCE from action params, excludes source.
{
    const sdkRegistry = makeSdkRegistry({
        holders: [
            { address: 'src-addr', balance: 1000 }, // source; should be excluded
            { address: 'addr-A', balance: 100 },
            { address: 'addr-B', balance: 50 },
        ],
        action: {
            actionIndex: 'idx-99',
            params: { TICK: 'XCP', SOURCE: 'src-addr' },
        },
    });
    const r = await getDividendRecipients({
        sdkRegistry, chainId: 'bitcoin-regtest', actionIndex: 'idx-99',
    });
    assert.equal(r.tick, 'XCP', 'tick resolved from action');
    assert.equal(r.source, 'src-addr', 'source captured');
    const addrs = r.recipients.map((x) => x.address);
    assert.deepEqual(addrs, ['addr-A', 'addr-B'], 'source address excluded');
}

// Holders shape variants: object envelope + uppercase fields.
{
    const sdkRegistry = makeSdkRegistry({
        holders: { holders: [{ ADDRESS: 'addr-X', BALANCE: 7 }] },
    });
    const r = await getDividendRecipients({
        sdkRegistry, chainId: 'bitcoin-regtest', tick: 'XCP',
    });
    assert.equal(r.recipients.length, 1, 'envelope shape works');
    assert.equal(r.recipients[0].address, 'addr-X', 'uppercase ADDRESS recognized');
    assert.equal(r.recipients[0].balance, '7', 'uppercase BALANCE recognized');
}

// Missing tick/actionIndex throws.
{
    await assert.rejects(
        () => getDividendRecipients({ sdkRegistry: makeSdkRegistry({ holders: [] }), chainId: 'bitcoin-regtest' }),
        /tick or actionIndex/i,
        'missing tick + actionIndex throws',
    );
}

// ─── 3. Behavioral AIRDROP round-trip ───────────────────────────────────

// Pre-resolved listActionIndex: skips the AIRDROP action lookup.
{
    const sdkRegistry = makeSdkRegistry({
        holders: [],
        list: {
            actionIndex: 'list-1',
            params: { TYPE: '2', ITEM: ['addr-1', 'addr-2', 'addr-1'] },
        },
    });
    const r = await getAirdropRecipients({
        sdkRegistry, chainId: 'bitcoin-regtest', listActionIndex: 'list-1',
    });
    assert.equal(r.listActionIndex, 'list-1');
    assert.equal(r.listType, '2', 'listType captured');
    assert.equal(r.recipients.length, 2, 'duplicate item deduped');
    assert.deepEqual(r.recipients.map((x) => x.address), ['addr-1', 'addr-2']);
}

// Action lookup path: pulls LIST_ACTION_INDEX from AIRDROP, then fetches list.
{
    const sdkRegistry = makeSdkRegistry({
        holders: [],
        action: {
            actionIndex: 'air-1',
            params: { TICK: 'XCP', AMOUNT: '10', LIST_ACTION_INDEX: 'list-1' },
        },
        list: {
            actionIndex: 'list-1',
            params: { TYPE: '2', ITEM: [{ address: 'addr-A' }, { ADDRESS: 'addr-B' }] },
        },
    });
    const r = await getAirdropRecipients({
        sdkRegistry, chainId: 'bitcoin-regtest', actionIndex: 'air-1',
    });
    assert.equal(r.listActionIndex, 'list-1', 'listActionIndex resolved');
    assert.equal(r.recipients.length, 2);
    assert.equal(r.recipients[0].address, 'addr-A');
    assert.equal(r.recipients[1].address, 'addr-B');
}

// Missing both throws.
{
    await assert.rejects(
        () => getAirdropRecipients({
            sdkRegistry: makeSdkRegistry({ holders: [] }),
            chainId: 'bitcoin-regtest',
        }),
        /listActionIndex or actionIndex/i,
        'missing fields throws',
    );
}

// ─── 4. createBackgroundHost wiring ─────────────────────────────────────

const hostSrc = readFileSync(
    join(wsRoot, 'packages/extension/src/background/createBackgroundHost.js'),
    'utf8',
);
assert.match(hostSrc, /getDividendRecipients[\s\S]+?getAirdropRecipients/,
    'host destructures both flows');
assert.match(hostSrc, /host\.register\('history\.getDividendRecipients'/,
    'history.getDividendRecipients route registered');
assert.match(hostSrc, /host\.register\('history\.getAirdropRecipients'/,
    'history.getAirdropRecipients route registered');

// ─── 5. Three messaging shells expose the shims ─────────────────────────

const shells = [
    'packages/extension/src/popup/messaging.js',
    'packages/web/src/messaging.js',
    'packages/desktop/renderer/messaging.js',
];
for (const shellPath of shells) {
    const src = readFileSync(join(wsRoot, shellPath), 'utf8');
    assert.match(src, /export function getDividendRecipients/, `${shellPath}: getDividendRecipients shim`);
    assert.match(src, /export function getAirdropRecipients/, `${shellPath}: getAirdropRecipients shim`);
    assert.match(src, /history\.getDividendRecipients/, `${shellPath}: routes to history.getDividendRecipients`);
    assert.match(src, /history\.getAirdropRecipients/, `${shellPath}: routes to history.getAirdropRecipients`);
}

// ─── 6. History.jsx mounts RecipientsBlock + consumes shims ─────────────

const historySrc = readFileSync(
    join(wsRoot, 'packages/core/src/shared/routes/History.jsx'),
    'utf8',
);
assert.match(historySrc, /<RecipientsBlock entry=\{entry\} \/>/, 'RecipientsBlock mounted');
assert.match(historySrc, /function RecipientsBlock\(/, 'RecipientsBlock component declared');
assert.match(historySrc, /messaging\.getDividendRecipients/, 'consumes getDividendRecipients');
assert.match(historySrc, /messaging\.getAirdropRecipients/, 'consumes getAirdropRecipients');
assert.match(historySrc, /Save \{recipients\.length\} as one contact/,
    'Save N as one contact button');

console.log('OK: DIVIDEND / AIRDROP recipient flow + host + shells + History UI');
