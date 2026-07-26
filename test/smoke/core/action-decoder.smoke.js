// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 4 piece 14 (plain-English action decoder + sign screens).
//
// Covers:
//   1. Pure decoder: SEND / SWEEP produce human sentences; memos with
//      `|` or `;` surface as warnings; empty destinations / non-positive
//      amounts surface as warnings; unknown actions fall back to a
//      generic summary + "no plain-English" warning.
//   2. Static wiring: core/src/index.js re-exports the decoder
//      namespace; the extension's SignApproval.jsx describes a dApp's
//      action through the `action.describe` HOST route (: the SDK's
//      hardened describer, not this local one) and renders its warnings.
//
// This local describer survives only as the in-form DRAFT preview for
// ~20 authoring surfaces (form state, synchronous, no host round-trip).
// Nothing that SIGNS reads it: the confirm page describes the composed
// action string host-side, and the approval window uses the route above.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    decoder as decoderLib,
    registry as registryLib,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Pure decoder --------------------------------------------------

const chainRegistry = registryLib.defaultRegistry();

// 1a. Happy SEND on bitcoin-mainnet.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'MYTOKEN', AMOUNT: '100', DESTINATION: 'bc1qxyz' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Send 100 MYTOKEN on Bitcoin to bc1qxyz');
    assert.deepEqual(
        d.details,
        [
            { label: 'Token', value: 'MYTOKEN' },
            { label: 'Amount', value: '100' },
            { label: 'Destination', value: 'bc1qxyz' },
        ],
    );
    assert.equal(d.warnings.length, 0, 'happy SEND has no warnings');
}

// 1b. SEND with memo containing `|` triggers a warning.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: {
            TICK: 'BTC',
            AMOUNT: '1',
            DESTINATION: 'bc1q',
            MEMO: 'hi|there',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(
        d.warnings.some((w) => /\|/.test(w)),
        'memo with pipe flagged as warning',
    );
    // Memo row included in details when non-empty.
    assert.ok(d.details.some((r) => r.label === 'Memo'));
}

// 1c. SEND with zero amount + empty destination → two warnings.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '0', DESTINATION: '' },
    });
    assert.ok(d.warnings.some((w) => /positive/i.test(w)), 'zero amount flagged');
    assert.ok(d.warnings.some((w) => /destination is empty/i.test(w)), 'empty dest flagged');
}

// 1d. SWEEP summarises the swept categories and warns about the move.
{
    const d = decoderLib.decodeAction({
        action: 'SWEEP',
        params: { DESTINATION: 'bc1qrecip' },
        chainId: 'dogecoin-mainnet',
        chainRegistry,
    });
    // No flags given → BALANCES/OWNERSHIPS default on, escrow flags off.
    assert.equal(d.summary, 'Sweep balances, ownerships on Dogecoin to bc1qrecip');
    assert.ok(
        d.warnings.some((w) => /sweep moves the selected/i.test(w)),
        'SWEEP has the selective-sweep warning',
    );
}

// 1e. Unknown / not-yet-decoded action falls back with the "no
// plain-English" warning. Using ORDER (Step 24 adds LIST + AIRDROP,
// so the fallback now exercises ORDER / SWAP / etc.
{
    const d = decoderLib.decodeAction({
        action: 'ORDER',
        params: { GIVE_TICK: 'XCP', GIVE_AMOUNT: '10', GET_COIN: 'BTC', GET_AMOUNT: '1' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Sign Order on Bitcoin/);
    assert.ok(
        d.warnings.some((w) => /no plain-english summary is available/i.test(w)),
        'fallback surfaces the "not decoded" warning',
    );
    assert.equal(d.details.length, 4, 'fallback pretty-prints every param');
}

// 1f. Missing chain registry still yields a sensible summary.
{
    const d = decoderLib.decodeAction({
        action: 'SEND',
        params: { TICK: 'BTC', AMOUNT: '1', DESTINATION: 'bc1q' },
    });
    assert.equal(d.summary, 'Send 1 BTC to bc1q');
}

// 1g. Null params shouldn't crash.
{
    const d = decoderLib.decodeAction({ action: 'SEND' });
    assert.equal(typeof d.summary, 'string');
    assert.ok(Array.isArray(d.details));
    assert.ok(Array.isArray(d.warnings));
}

// --- 2. Phase 2 decoders: ISSUE / MINT / DESTROY / BATCH ------------

// 2a. ISSUE v0 fresh-create: Meme-template shape (MAX_SUPPLY + MINT_SUPPLY + lock flags).
{
    const d = decoderLib.decodeAction({
        action: 'ISSUE',
        params: {
            VERSION: '0',
            TICK: 'NEWCOIN',
            MAX_SUPPLY: '1000000',
            MINT_SUPPLY: '1000000',
            DECIMALS: '0',
            LOCK_MAX_SUPPLY: '1',
            LOCK_MINT: '1',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(
        d.summary,
        'Create token NEWCOIN with max supply 1000000 on Bitcoin',
        'ISSUE v0 with MAX_SUPPLY reads as "Create token"',
    );
    assert.ok(d.details.some((r) => r.label === 'Locking'), 'locks listed in details');
    assert.ok(
        d.details.find((r) => r.label === 'Locking').value.includes('max supply'),
        'lock label reads "max supply" not "LOCK_MAX_SUPPLY"',
    );
    assert.ok(
        d.details.find((r) => r.label === 'Locking').value.includes('minting'),
        'lock label reads "minting" not "LOCK_MINT"',
    );
    assert.ok(
        d.warnings.some((w) => /locking is permanent/i.test(w)),
        'ISSUE with lock flags surfaces the permanent-lock warning',
    );
}

// 2b. ISSUE v0 transfer-only: TRANSFER set, no supply/mint fields.
{
    const d = decoderLib.decodeAction({
        action: 'ISSUE',
        params: {
            VERSION: '0',
            TICK: 'MYTOKEN',
            TRANSFER: 'bc1qnewowner',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(
        d.summary,
        'Transfer ownership of MYTOKEN to bc1qnewowner on Bitcoin',
    );
    assert.ok(
        d.details.some((r) => r.label === 'Transfer ownership to' && r.value === 'bc1qnewowner'),
    );
}

// 2c. ISSUE v1 update-description.
{
    const d = decoderLib.decodeAction({
        action: 'ISSUE',
        params: {
            VERSION: '1',
            TICK: 'MYTOKEN',
            DESCRIPTION: 'A shiny new description',
        },
        chainId: 'dogecoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Update description of MYTOKEN on Dogecoin');
    assert.ok(
        d.details.some((r) => r.label === 'New description' && r.value === 'A shiny new description'),
    );
    assert.equal(d.warnings.length, 0, 'description update alone has no warnings');
}

// 2d. ISSUE v3 lock-params: summary names what's being locked.
{
    const d = decoderLib.decodeAction({
        action: 'ISSUE',
        params: {
            VERSION: '3',
            TICK: 'MYTOKEN',
            LOCK_MAX_SUPPLY: '1',
            LOCK_DESCRIPTION: '1',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Lock MYTOKEN/);
    assert.match(d.summary, /max supply/);
    assert.match(d.summary, /description/);
    assert.ok(
        d.warnings.some((w) => /locking is permanent/i.test(w)),
        'ISSUE v3 with flags warns about permanence',
    );
}

// 2e. MINT happy path.
{
    const d = decoderLib.decodeAction({
        action: 'MINT',
        params: {
            VERSION: '0',
            TICK: 'MYTOKEN',
            AMOUNT: '100',
            DESTINATION: 'bc1qrecip',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Mint 100 MYTOKEN on Bitcoin to bc1qrecip');
    assert.equal(d.warnings.length, 0, 'happy MINT has no warnings');
}

// 2f. MINT with no destination reads as "to broadcasting address".
{
    const d = decoderLib.decodeAction({
        action: 'MINT',
        params: { TICK: 'MYTOKEN', AMOUNT: '100' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.ok(
        d.details.some((r) => r.label === 'Destination' && r.value === 'broadcasting address'),
        'empty DESTINATION renders as "broadcasting address"',
    );
}

// 2g. MINT with zero amount warns.
{
    const d = decoderLib.decodeAction({
        action: 'MINT',
        params: { TICK: 'MYTOKEN', AMOUNT: '0' },
    });
    assert.ok(
        d.warnings.some((w) => /not positive/i.test(w)),
        'MINT zero-amount flagged',
    );
}

// 2h. DESTROY v0 single.
{
    const d = decoderLib.decodeAction({
        action: 'DESTROY',
        params: { VERSION: '0', TICK: 'MYTOKEN', AMOUNT: '50' },
        chainId: 'litecoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Destroy 50 MYTOKEN on Litecoin');
    assert.ok(
        d.warnings.some((w) => /irreversible/i.test(w)),
        'DESTROY always warns about irreversibility',
    );
}

// 2i. DESTROY multi-version falls through to generic but keeps the
//     irreversibility warning.
{
    const d = decoderLib.decodeAction({
        action: 'DESTROY',
        params: { VERSION: '1', TICK: 'MYTOKEN', AMOUNT: '10' },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Sign Destroy/);
    assert.ok(
        d.warnings[0] && /irreversible/i.test(d.warnings[0]),
        'multi-destroy still leads with the irreversibility warning',
    );
}

// 2j. BATCH composes child summaries.
{
    const d = decoderLib.decodeAction({
        action: 'BATCH',
        params: {
            COMMANDS: [
                {
                    action: 'ISSUE',
                    params: {
                        VERSION: '0',
                        TICK: 'NEWCOIN',
                        MAX_SUPPLY: '1000',
                    },
                },
                {
                    action: 'MINT',
                    params: { VERSION: '0', TICK: 'NEWCOIN', AMOUNT: '1000' },
                },
            ],
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Batch of 2 actions on Bitcoin/);
    assert.match(d.summary, /Create token NEWCOIN/);
    assert.match(d.summary, /Mint 1000 NEWCOIN/);
    assert.ok(
        d.details.some((r) => r.label === 'Step 1'),
        'BATCH details label sub-actions as Step N',
    );
    assert.ok(
        d.details.some((r) => r.label === 'Step 2'),
    );
}

// 2k. BATCH with no COMMANDS warns so the user doesn't sign blind.
{
    const d = decoderLib.decodeAction({
        action: 'BATCH',
        params: {},
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Batch of actions on Bitcoin/);
    assert.ok(
        d.warnings.some((w) => /no decoded commands/i.test(w)),
        'empty BATCH surfaces a "review raw tx" warning',
    );
}

// --- 2.5. Step 24 decoders: LIST v0/v1 + AIRDROP v0/v1/v2/v3 --------

// 2l. LIST v0 create: address list.
{
    const d = decoderLib.decodeAction({
        action: 'LIST',
        params: {
            VERSION: '0',
            TYPE: '2',
            ITEM: ['bc1qa', 'bc1qb', 'bc1qc'],
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Create address list of 3 items on Bitcoin');
    assert.ok(
        d.details.some((r) => r.label === 'Type' && /Address/.test(r.value)),
        'LIST v0 type row reads Address',
    );
    assert.ok(
        d.details.some((r) => r.label === 'Items' && r.value === '3'),
    );
    assert.equal(d.warnings.length, 0, 'happy LIST v0 has no warnings');
}

// 2m. LIST v0 create: TICK list, empty items warns.
{
    const d = decoderLib.decodeAction({
        action: 'LIST',
        params: { VERSION: '0', TYPE: '1', ITEM: [] },
    });
    assert.match(d.summary, /Create token list/);
    assert.ok(
        d.warnings.some((w) => /no items/i.test(w)),
        'empty LIST warns',
    );
}

// 2n. LIST v0 missing type warns.
{
    const d = decoderLib.decodeAction({
        action: 'LIST',
        params: { VERSION: '0', ITEM: ['X'] },
    });
    assert.ok(
        d.warnings.some((w) => /type is empty/i.test(w)),
        'LIST v0 without TYPE warns',
    );
}

// 2o. LIST v1 add: summary names the parent list.
{
    const d = decoderLib.decodeAction({
        action: 'LIST',
        params: {
            VERSION: '1',
            EDIT: '1',
            LIST_ACTION_INDEX: '1234',
            ITEM: ['bc1qa', 'bc1qb'],
        },
        chainId: 'litecoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Add 2 items to list #1234 on Litecoin');
    assert.ok(
        d.details.some((r) => r.label === 'Edit' && r.value === 'Add'),
    );
}

// 2p. LIST v1 remove: preposition switches to "from".
{
    const d = decoderLib.decodeAction({
        action: 'LIST',
        params: {
            VERSION: '1', EDIT: '2', LIST_ACTION_INDEX: '4321', ITEM: ['bc1qa'],
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Remove 1 item from list #4321/);
}

// 2q. AIRDROP v0: single happy path.
{
    const d = decoderLib.decodeAction({
        action: 'AIRDROP',
        params: {
            VERSION: '0', TICK: 'MYTOKEN', AMOUNT: '10',
            LIST_ACTION_INDEX: '1234',
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.equal(d.summary, 'Airdrop 10 MYTOKEN on Bitcoin to list #1234');
    assert.ok(
        d.details.some((r) => r.label === 'List action index' && r.value === '#1234'),
    );
    assert.equal(d.warnings.length, 0, 'happy AIRDROP v0 has no warnings');
}

// 2r. AIRDROP v0: missing list index warns.
{
    const d = decoderLib.decodeAction({
        action: 'AIRDROP',
        params: { VERSION: '0', TICK: 'MYTOKEN', AMOUNT: '10' },
    });
    assert.ok(
        d.warnings.some((w) => /list action index is empty/i.test(w)),
    );
}

// 2s. AIRDROP v0: memo pipe is rejected.
{
    const d = decoderLib.decodeAction({
        action: 'AIRDROP',
        params: {
            VERSION: '0', TICK: 'X', AMOUNT: '1', LIST_ACTION_INDEX: '1',
            MEMO: 'bad|memo',
        },
    });
    assert.ok(
        d.warnings.some((w) => /\| or ;/.test(w)),
    );
}

// 2t. AIRDROP v1: multi-token, single list.
{
    const d = decoderLib.decodeAction({
        action: 'AIRDROP',
        params: {
            VERSION: '1',
            LIST_ACTION_INDEX: '1234',
            TICK: ['GAS', 'BRRR'],
            AMOUNT: ['1', '2'],
        },
        chainId: 'bitcoin-mainnet',
        chainRegistry,
    });
    assert.match(d.summary, /Airdrop on Bitcoin: 1 GAS → list #1234, 2 BRRR → list #1234/);
}

// 2u. AIRDROP v2: multi-token, multi-list.
{
    const d = decoderLib.decodeAction({
        action: 'AIRDROP',
        params: {
            VERSION: '2',
            TICK: ['GAS', 'BRRR'],
            AMOUNT: ['1', '2'],
            LIST_ACTION_INDEX: ['1234', '4321'],
        },
    });
    assert.match(d.summary, /1 GAS → list #1234, 2 BRRR → list #4321/);
}

// --- 3. Static wiring -------------------------------------------------

const coreIdx = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'index.js'),
    'utf8',
);
assert.ok(
    coreIdx.includes("export * as decoder from './decoder/index.js'"),
    'core/src/index.js re-exports the decoder namespace',
);

const sign = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'SignApproval.jsx'),
    'utf8',
);
//  §3.2/§3.5: the approval window describes through the SDK, on the
// host, and no longer through this local describer. Inverted deliberately
// rather than deleted: these params are the one set on any signing surface
// an ATTACKER wrote, the local describer applies none of §3.5's hardening
// (no bidi/zero-width neutralization, no amount flagging), and it covers 13
// actions to the SDK's 30. A regression here is a security regression, so
// the smoke now forbids exactly what it used to require.
assert.ok(
    !/decoderLib\.decodeAction/.test(sign),
    'SignApproval.jsx no longer describes dApp params with the wallet-local describer',
);
assert.ok(
    /describeAction as describeActionOnHost/.test(sign)
        && /describeActionOnHost\(/.test(sign),
    'SignApproval.jsx describes via the action.describe host route (sdk.decoder.describe)',
);
const hostFile = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(
    /host\.register\('action\.describe'/.test(hostFile)
        && /sdk\.decoder\.describe\(/.test(hostFile),
    'the action.describe host route runs sdk.decoder.describe',
);
assert.ok(
    /decoded\.warnings/.test(sign),
    'SignApproval.jsx renders the warnings array',
);
assert.ok(
    /decoded\.details/.test(sign),
    'SignApproval.jsx renders the details array',
);

const signCss = readFileSync(
    join(ext, 'src', 'approval', 'kinds', 'SignApproval.module.css'),
    'utf8',
);
assert.ok(signCss.includes('.warnings'), 'warnings block has a style');
assert.ok(signCss.includes('.detailsList'), 'details list has a style');

console.log(
    'OK: action decoder smoke (28 cases: SEND + SWEEP + ISSUE v0/v1/v3 + MINT + DESTROY v0 + DESTROY multi-fallback + BATCH + LIST v0/v1 + AIRDROP v0/v1/v2 + fallback + null-safety + SignApproval wiring)',
);
