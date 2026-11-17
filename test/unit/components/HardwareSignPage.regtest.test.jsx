// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A Ledger signs regtest in its Bitcoin Test app, which prints tb1... where
// the wallet shows bcrt1... for the same key. The sign page says so in one
// line, only for a Ledger send on regtest.

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HardwareSignPage, showsTestnetPrefix } from '../../../packages/core/src/shared/components/HardwareSignPage.jsx';
import { begin, current, end, subscribe } from '../../../packages/core/src/signers/hardwareSession.js';
import { makeHardwareSessionSigner } from '../../../packages/core/src/signers/hardwareReconnect.js';

const LINE = 'Your Ledger shows this address starting with tb1.';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function show(info) {
    render(<HardwareSignPage />);
    let id;
    act(() => { id = begin({ signerId: 's1', model: 'Nano X', ...info }); });
    return () => act(() => end(id));
}

describe('<HardwareSignPage> on a Ledger regtest send', () => {
    it('shows the tb1 line for a Ledger send on regtest', () => {
        const close = show({ vendor: 'ledger', op: 'signPsbt', chainId: 'bitcoin-regtest' });
        expect(screen.getByText(LINE)).toBeInTheDocument();
        close();
    });

    for (const [label, info] of [
        ['a Ledger send on testnet', { vendor: 'ledger', op: 'signPsbt', chainId: 'bitcoin-testnet' }],
        ['a Ledger send on mainnet', { vendor: 'ledger', op: 'signPsbt', chainId: 'bitcoin-mainnet' }],
        ['a Trezor send on regtest', { vendor: 'trezor', op: 'signPsbt', chainId: 'bitcoin-regtest' }],
        ['a Ledger message on regtest', { vendor: 'ledger', op: 'signMessage', chainId: 'bitcoin-regtest' }],
        ['a Ledger send with no chain', { vendor: 'ledger', op: 'signPsbt' }],
    ]) {
        it(`shows no tb1 line for ${label}`, () => {
            const close = show(info);
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            expect(screen.queryByText(LINE)).toBeNull();
            close();
        });
    }

    it('decides from vendor, chain and op only', () => {
        expect(showsTestnetPrefix({ vendor: 'ledger', op: 'signPsbt', chainId: 'bitcoin-regtest' })).toBe(true);
        expect(showsTestnetPrefix({ vendor: 'ledger', op: 'signPsbt', chainId: null })).toBe(false);
        expect(showsTestnetPrefix(null)).toBe(false);
    });

    it('the session signer hands the sign op its chain, so a real regtest send reaches the line', async () => {
        const seen = [];
        const unsubscribe = subscribe((event) => { if (event.type === 'begin') seen.push(event.op.chainId); });
        let release;
        const live = {
            getStatus: async () => 'available',
            signPsbt: () => new Promise((resolve) => { release = resolve; }),
        };
        const session = makeHardwareSessionSigner(
            { id: 'sig-ledger', vendor: 'ledger', model: 'nanoX', deviceIdentifier: 'dev' },
            { live },
        );
        render(<HardwareSignPage />);
        let pending;
        await act(async () => {
            pending = session.signPsbt({ psbtHex: '70736274ff', chainId: 'bitcoin-regtest', signingPaths: [] });
            await Promise.resolve();
        });
        expect(seen).toEqual(['bitcoin-regtest']);
        expect(current()?.chainId).toBe('bitcoin-regtest');
        expect(screen.getByText(LINE)).toBeInTheDocument();
        await act(async () => {
            release({ signedPsbtHex: '', txHex: 'aa', txid: 'bb' });
            await pending;
        });
        unsubscribe();
    });
});
