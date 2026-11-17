// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A Ledger that has another app open than the chain needs fails the sign
// with a wrong-app kind, and the sign page names the app to open ("Open the
// Litecoin app on your Ledger, then try again.") instead of the generic
// couldn't-sign line. The kind survives the signer port, which carries only
// an error's name and message.

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HardwareSignPage, failureLine } from '../../../packages/core/src/shared/components/HardwareSignPage.jsx';
import {
    begin, end, fail, failureKind, isWrongAppError, runSignOp, subscribe,
} from '../../../packages/core/src/signers/hardwareSession.js';
import { hardwareSigningError } from '../../../packages/core/src/signers/Signer.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('failureKind: wrong app', () => {
    it.each([
        ['the typed signer error', hardwareSigningError('s1', 'ledger', Object.assign(new Error('UNKNOWN_ERROR'), { statusCode: 0x6a82 }))],
        ['only its message, as a signer port carries it', { name: 'SignerStatusError', message: 'The wrong app is open on your Ledger. Open the app for this network, then try again.' }],
        ['the reconnect refusal', { code: 'HW_WRONG_APP', message: "The Bitcoin app can't confirm this is the Ledger this wallet uses." }],
        ['a raw path refusal', new Error('Ledger device: UNKNOWN_ERROR (0x6a82)')],
        ['the dashboard answering', new Error('INS_NOT_SUPPORTED (0x6d00)')],
    ])('%s is wrong-app', (_label, err) => {
        expect(failureKind(err)).toBe('wrong-app');
        expect(isWrongAppError(err)).toBe(true);
    });

    it('leaves the other kinds alone', () => {
        expect(failureKind(new Error('Request timed out'))).toBe('timeout');
        expect(failureKind({ code: 'HW_NOT_CONNECTED', message: 'x' })).toBe('unplugged');
        expect(failureKind(new Error('0x6985 denied by user'))).toBe('rejected');
        expect(failureKind(new Error('Something odd'))).toBe('other');
        expect(isWrongAppError(new Error('Something odd'))).toBe(false);
        expect(isWrongAppError(null)).toBe(false);
    });

    it('a sign op refused as the wrong app fails on the page with that kind', async () => {
        const seen = [];
        const stop = subscribe((event) => { if (event.type === 'fail') seen.push(event.op); });
        const attempt = vi.fn(async () => {
            throw hardwareSigningError('s1', 'ledger', Object.assign(new Error('UNKNOWN_ERROR'), { statusCode: 0x6a82 }));
        });
        const signing = runSignOp(
            { signerId: 's1', vendor: 'ledger', model: 'nanoX', op: 'signPsbt', chainId: 'litecoin-mainnet' },
            attempt,
        );
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        expect(seen[0].failure).toEqual({ kind: 'wrong-app' });
        expect(seen[0].chainId).toBe('litecoin-mainnet');
        stop();
        // The op waits for Try again or Back; this test only reads the kind.
        end(seen[0].opId);
        signing.catch(() => {});
    });
});

describe('the sign page on a wrong-app failure', () => {
    it.each([
        ['litecoin-mainnet', 'Open the Litecoin app on your Ledger, then try again.'],
        ['dogecoin-mainnet', 'Open the Dogecoin app on your Ledger, then try again.'],
        ['bitcoin-mainnet', 'Open the Bitcoin app on your Ledger, then try again.'],
        ['bitcoin-testnet', 'Open the Bitcoin Test app on your Ledger, then try again.'],
        ['bitcoin-regtest', 'Open the Bitcoin Test app on your Ledger, then try again.'],
    ])('names the app for %s', (chainId, line) => {
        render(<HardwareSignPage />);
        let id;
        act(() => {
            id = begin({ signerId: 's1', vendor: 'ledger', model: 'nanoX', op: 'signPsbt', chainId });
            fail(id, { kind: 'wrong-app' });
        });
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(line);
        expect(alert.textContent).not.toMatch(/couldn't sign/i);
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        act(() => end(id));
    });

    it('falls back to a generic app line when the chain is unknown, and keeps the couldn\'t-sign line for a Trezor', () => {
        expect(failureLine({ vendor: 'ledger', chainId: null, failure: { kind: 'wrong-app' } }))
            .toBe('Open the app for this network on your Ledger, then try again.');
        expect(failureLine({ vendor: 'trezor', chainId: 'bitcoin-mainnet', failure: { kind: 'wrong-app' } }))
            .toBe("Your Trezor couldn't sign. Nothing was signed.");
        expect(failureLine({ vendor: 'ledger', chainId: 'bitcoin-mainnet', failure: null })).toBeNull();
        expect(failureLine({ vendor: 'ledger', chainId: 'bitcoin-mainnet', failure: { kind: 'rejected' } }))
            .toBe('Signing was rejected on your Ledger. Nothing was signed.');
    });
});
