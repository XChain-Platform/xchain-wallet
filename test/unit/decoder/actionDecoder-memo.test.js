// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A memo the wallet commits on-chain must appear on the Confirm page.
//
// The memo is permanent and public, and the Confirm page is the screen the
// user is told to verify intent on (the hardware note on that same screen
// says exactly that). FILE committed a memo and never showed it (issue #39),
// and LINK had the same gap beside it: `fileActionParams` and the LINK params
// builder both set MEMO, and neither decoder read it back.
//
// Per-action tests only prove what someone remembered to write, which is how
// two decoders drifted out of a rule the other sixteen follow. So this
// enumerates instead: an action that renders the row today and stops
// rendering it fails here, and a new memo-carrying action added without a row
// fails on the list rather than on a signing screen.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

// Measured against the decoder, not guessed: every ACTION that renders a
// `Memo` row for at least one VERSION. Adding an action here without teaching
// its decoder the row fails, which is the point.
const MEMO_RENDERING_ACTIONS = [
    'ADDRESS', 'AIRDROP', 'BET', 'BROADCAST', 'DESTROY', 'DISPENSER',
    'DIVIDEND', 'FILE', 'ISSUE', 'LINK', 'LIST', 'MINT', 'ORDER', 'PRICE',
    'SEND', 'SWAP', 'SWEEP', 'VOTE',
];

// Several decoders branch on VERSION and only carry a memo on some of them,
// so "renders the row" means "for at least one version", not "for all".
const VERSIONS = ['0', '1', '2', '3'];

function rendersMemo(action, memo) {
    for (const VERSION of VERSIONS) {
        let out;
        try {
            out = decodeAction({ action, params: { MEMO: memo, VERSION }, chainId: '' });
        } catch {
            continue;
        }
        if ((out?.details || []).some((d) => d.label === 'Memo' && d.value === memo)) return true;
    }
    return false;
}

describe('decodeAction memo disclosure', () => {
    for (const action of MEMO_RENDERING_ACTIONS) {
        it(`${action} renders the memo it commits`, () => {
            expect(rendersMemo(action, 'first publish-file test')).toBe(true);
        });
    }
});

// The two the issue named, pinned directly rather than only through the list
// above, so a regression reads as the reported bug instead of a list diff.
describe('FILE confirm intent (issue #39)', () => {
    const decode = (params) => decodeAction({ action: 'FILE', params, chainId: '' });

    it('shows the memo beside the name, type and title', () => {
        const out = decode({
            NAME: 'publish-test.json',
            TYPE: 'application/json',
            TITLE: 'Publish test',
            MEMO: 'first publish-file test',
        });
        expect(out.details).toEqual(expect.arrayContaining([
            { label: 'Name', value: 'publish-test.json' },
            { label: 'Type', value: 'application/json' },
            { label: 'Title', value: 'Publish test' },
            { label: 'Memo', value: 'first publish-file test' },
        ]));
    });

    it('omits the row when there is no memo, rather than showing an empty one', () => {
        const out = decode({ NAME: 'a.txt', TYPE: 'text/plain' });
        expect(out.details.some((d) => d.label === 'Memo')).toBe(false);
    });

    it('warns on a memo carrying a reserved character', () => {
        for (const memo of ['has|pipe', 'has;semi']) {
            expect(decode({ NAME: 'a.txt', MEMO: memo }).warnings).toContain(
                'Memo contains | or ;: the protocol will reject this transaction.',
            );
        }
    });

    it('still warns about permanence, which the memo row must not displace', () => {
        const out = decode({ NAME: 'a.txt', MEMO: 'hi' });
        expect(out.warnings.some((w) => /permanent and public/.test(w))).toBe(true);
    });
});

describe('LINK confirm intent (same gap as #39)', () => {
    const decode = (params) => decodeAction({ action: 'LINK', params, chainId: '' });

    it('shows the memo beside both sides of the pairing', () => {
        const out = decode({
            COIN1: 'BTC',
            COIN1_ACTION_INDEX: '11',
            COIN2: 'DOGE',
            COIN2_ACTION_INDEX: '22',
            MEMO: 'pairing note',
        });
        expect(out.details).toEqual(expect.arrayContaining([
            { label: 'Chain 1', value: 'BTC' },
            { label: 'Chain 2', value: 'DOGE' },
            { label: 'Memo', value: 'pairing note' },
        ]));
    });

    it('omits the row for the empty memo the LINK params builder always sets', () => {
        // linkAction.js sets `MEMO: typeof opts.memo === 'string' ? opts.memo : ''`,
        // so an empty string reaches the decoder on every unmemoed LINK.
        const out = decode({ COIN1: 'BTC', COIN2: 'DOGE', MEMO: '' });
        expect(out.details.some((d) => d.label === 'Memo')).toBe(false);
    });

    it('keeps warning when a chain is missing', () => {
        const out = decode({ COIN1: 'BTC', MEMO: 'x' });
        expect(out.warnings).toContain('Both chains must be specified.');
    });
});
