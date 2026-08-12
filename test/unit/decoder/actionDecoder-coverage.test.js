// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Summary coverage across every protocol ACTION.
//
// The draft-preview describer is what a user reads at a form's review
// stage, right before the confirm screen. It covered 13 of the 31
// actions, so SWAP, STAKE, VOTE, EXECUTE and 14 others rendered "No
// plain-English summary is available for X yet" with a warning banner on
// the surface where intent is verified. Case-by-case tests only prove
// what someone remembered to write, so this enumerates the action list
// instead: a new protocol action with no describer fails here rather
// than on a signing screen.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

// The protocol's ACTION set, mirroring xchain-sdk/src/formats.js. Kept
// literal because @xchain-wallet/core deliberately does not depend on
// the SDK; a drift between the two lists shows up as an SDK action with
// no case here, which is exactly what this file exists to catch.
const PROTOCOL_ACTIONS = [
    'ADDRESS', 'AIRDROP', 'BATCH', 'BET', 'BROADCAST', 'CALLBACK', 'COINPAY',
    'COLLECT', 'DELEGATE', 'DEPLOY', 'DEPOSIT', 'DESTROY', 'DISPENSER',
    'DIVIDEND', 'EXECUTE', 'FILE', 'ISSUE', 'LINK', 'LIST', 'MESSAGE', 'MINT',
    'ORDER', 'PRICE', 'SEND', 'SLEEP', 'STAKE', 'SWAP', 'SWEEP', 'UNSTAKE',
    'VOTE', 'WITHDRAW',
];

const GENERIC = /No plain-English summary is available/;

describe('decodeAction summary coverage', () => {
    for (const action of PROTOCOL_ACTIONS) {
        it(`${action} has a plain-English summary`, () => {
            // Params empty on purpose: a describer must build its summary
            // from the action alone, filling gaps with "?" rather than
            // dropping to the generic path.
            const d = decodeAction({ action, params: {} });
            expect(d.warnings.join('\n')).not.toMatch(GENERIC);
            expect(d.summary).toBeTypeOf('string');
            expect(d.summary).not.toBe('');
            // "Sign <Label>" is the generic fallback's summary shape.
            expect(d.summary).not.toMatch(/^Sign /);
        });
    }

    // The versioned actions carry different SEMANTICS per version, not
    // just different fields, so a summary that ignores the version can be
    // actively misleading (a revoke reading as a rotate, a cancel reading
    // as a create). Spot-check the pairs where that matters.
    const versioned = [
        ['ORDER', { VERSION: '1', ORDER_ACTION_INDEX: '42' }, /^Cancel order \(#42\)$/],
        ['ORDER', { VERSION: '2', ORDER_ACTION_INDEX: '42' }, /^Edit order \(#42\)$/],
        ['SWAP', { VERSION: '1', SWAP_ACTION_INDEX: '7' }, /^Cancel swap \(#7\)$/],
        ['STAKE', { VERSION: '2', AMOUNT: '50', SIGNING_PUBKEY: 'aabb' }, /top-up/],
        ['STAKE', { VERSION: '3', AMOUNT: '50', TICK: 'JDOG', TARGET_CONTRACT_INDEX: '9' }, /to contract #9/],
        ['DELEGATE', { VERSION: '0', NEW_SIGNING_PUBKEY: 'aabb' }, /^Rotate validator signing key/],
        ['DELEGATE', { VERSION: '2', SIGNING_PUBKEY: 'aabb' }, /^Revoke validator signing key/],
        ['VOTE', { VERSION: '1', POLL_REF: '5', BALLOT: 'yes' }, /^Cast ballot "yes" on poll #5/],
        ['VOTE', { VERSION: '3', TICK: 'JDOG', DELEGATE_TO: 'addr9' }, /^Delegate JDOG voting power to addr9/],
        ['VOTE', { VERSION: '3', TICK: 'JDOG' }, /^Clear JDOG vote delegation/],
        ['MESSAGE', { VERSION: '2', DESTINATION: 'addr9' }, /^Send encrypted message to addr9/],
        ['MESSAGE', { VERSION: '3', DESTINATION: 'addr9', PLAINTEXT_MESSAGE: 'hi' }, /^Send public message to addr9/],
        ['DEPLOY', { VERSION: '4', CHUNK_INDEX: '1', TOTAL_CHUNKS: '4' }, /chunk 1 of 4/],
        ['ADDRESS', { VERSION: '1', CONTROLLER: '42', ACTION_CLASS: 'transfer', UNBIND: '1' }, /^Unbind controller from this address \(transfer\)$/],
    ];
    for (const [action, params, re] of versioned) {
        it(`${action} v${params.VERSION} names its own semantics`, () => {
            expect(decodeAction({ action, params }).summary).toMatch(re);
        });
    }

    it('SWAP creation reads as a swap, with both sides named', () => {
        const d = decodeAction({
            action: 'SWAP',
            params: {
                VERSION: '0', GIVE_TICK: 'JDOG', GIVE_AMOUNT: '100',
                GET_TICK: 'PEPE', GET_AMOUNT: '250',
            },
        });
        expect(d.summary).toBe('Create swap: give 100 JDOG for 250 PEPE');
        expect(d.warnings.join('\n')).not.toMatch(GENERIC);
    });

    it('STAKE names the amount and states the lock-up', () => {
        const d = decodeAction({
            action: 'STAKE',
            params: { VERSION: '1', AMOUNT: '50', SIGNING_PUBKEY: 'f223ca100' },
        });
        expect(d.summary).toBe('Stake 50 (new validator stake)');
        expect(d.warnings.join('\n')).toContain('locked until unstake plus the cooldown');
    });

    it('a native-coin order side is labelled as the native coin', () => {
        const d = decodeAction({
            action: 'ORDER',
            params: {
                VERSION: '0', GIVE_COIN: 'BTC', GIVE_AMOUNT: '0.5',
                GET_TICK: 'JDOG', GET_AMOUNT: '1000',
            },
        });
        expect(d.summary).toBe('Create order: give 0.5 BTC (native coin) for 1000 JDOG');
    });

    it('multi-destroy lists every leg instead of falling back', () => {
        const d = decodeAction({
            action: 'DESTROY',
            params: { VERSION: '1', TICK: ['JDOG', 'PEPE'], AMOUNT: ['5', '7'], MEMO: 'bye' },
        });
        expect(d.summary).toBe('Destroy: 5 JDOG, 7 PEPE');
        expect(d.warnings.join('\n')).toContain('irreversible');
        expect(d.warnings.join('\n')).not.toMatch(GENERIC);
    });

    it('an action outside the protocol still degrades to the generic fallback', () => {
        // The fallback must stay reachable: an unknown action is exactly
        // the case where "review the raw parameters" is the honest thing
        // to say, and silently inventing a summary would be worse.
        const d = decodeAction({ action: 'NOT_AN_ACTION', params: { FOO: 'bar' } });
        expect(d.warnings.join('\n')).toMatch(GENERIC);
    });
});
