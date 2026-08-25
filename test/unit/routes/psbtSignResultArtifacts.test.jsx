// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The PSBT signing RESULT screen renders whichever artifact the lane it ran
// actually produced. The two lanes return different ones: the software signer
// returns a signed PSBT, and both device signers return `signedPsbtHex: ''`
// plus a fully serialized transaction, because a device hands back a tx rather
// than a PSBT (LedgerSigner.signPsbt:371, TrezorSigner.signPsbt:259, contract
// at Signer.js SignPsbtReturn). Keying the single result block on
// signedPsbtHex alone therefore rendered an empty <pre> and a copy button that
// copied nothing after every successful hardware signing, under a caption
// telling the user to pass the transaction to "the next cosigner" - which a
// device-signed raw transaction has none of.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const OTHER = 'bc1qotherotherotherotherotherotherotherx';
const PSBT_HEX = '70736274ff01000000';

const DECOMPOSED = Object.freeze({
    inputs: [{ address: OWN, value: 100000 }],
    outputs: [{ address: OTHER, value: 90000 }, { address: OWN, value: 5000 }],
});

function addressRecord(source) {
    return Object.freeze({
        id: `addr-${source}`,
        address: OWN,
        publicKey: '02aabbcc',
        derivationPath: "m/84'/0'/0'/0/0",
        source,
        signerId: `signer-${source}`,
    });
}

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function findButton(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

// Drives the screen to its RESULT state for one lane. `source` picks the
// address record's signer kind, which is what PsbtSignForm branches on to
// choose signPsbtUserInitiatedHw over signPsbtUserInitiated.
async function driveToResult({ source, result }) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [addressRecord(source)] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        // HwSignBlock polls this and the parent gates Submit on 'available',
        // so a hardware run only reaches the device call with a live device.
        getSignerStatus: () => Promise.resolve({ status: 'available' }),
        getSignerInfo: () => Promise.resolve({ kind: source, status: 'available' }),
        listSigners: () => Promise.resolve([{ id: `signer-${source}`, kind: source, status: 'available' }]),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        parsePsbtRequest: () => Promise.resolve({
            decomposed: DECOMPOSED,
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        }),
        signPsbtUserInitiated: (args) => {
            calls.push({ method: 'signPsbtUserInitiated', args });
            return Promise.resolve(result);
        },
        signPsbtUserInitiatedHw: (args) => {
            calls.push({ method: 'signPsbtUserInitiatedHw', args });
            return Promise.resolve(result);
        },
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({});
            };
        },
    });

    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(PsbtSignForm, { walletId: 'w', onBack() {} }),
            ),
        );
        await drainMicrotasks();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(/Unsigned transaction/i), { target: { value: PSBT_HEX } });
        await drainMicrotasks();
    });
    // The hardware branch relabels its own submit ("Sign on Ledger"), so match
    // either. A missing button would silently skip the signing step, so fail
    // loudly instead of asserting against a screen that never advanced.
    const submitBtn = findButton(utils, /Sign transaction|Sign on (Ledger|Trezor)/i);
    expect(submitBtn, 'submit button present and enabled').toBeTruthy();
    expect(submitBtn.disabled).toBe(false);
    await domAct(async () => {
        fireEvent.click(submitBtn);
        await drainMicrotasks();
    });
    // The software lane routes through the shared confirm page; approve there.
    const approve = utils.queryByTestId('confirm-approve');
    if (approve) {
        const pw = utils.queryByLabelText('Password');
        if (pw) {
            await domAct(async () => {
                fireEvent.change(pw, { target: { value: 'hunter2' } });
                await drainMicrotasks();
            });
        }
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drainMicrotasks();
        });
    }
    return { utils, calls };
}

describe('PSBT signing result screen renders the artifact the lane produced', () => {
    it('the HARDWARE lane shows the raw signed transaction, not an empty block', async () => {
        const { utils, calls } = await driveToResult({
            source: 'ledger',
            result: { signedPsbtHex: '', txHex: 'cc22', txid: 'dd33' },
        });
        // Guard the fixture itself: if the hardware lane was never taken, the
        // assertions below would be about the software screen.
        expect(calls.some((c) => c.method === 'signPsbtUserInitiatedHw')).toBe(true);

        const rawBlock = utils.queryByTestId('signed-tx-hex');
        expect(rawBlock).toBeTruthy();
        expect(rawBlock.textContent).toBe('cc22');
        // No PSBT was produced, so no PSBT block and no copy button over ''.
        expect(utils.queryByTestId('signed-psbt-hex')).toBe(null);
        expect(utils.container.textContent).toContain('Signed transaction (raw hex)');
        // A device-signed transaction is complete; there is no next cosigner.
        expect(utils.container.textContent).not.toContain('next cosigner');
    });

    it('the SOFTWARE lane still shows the signed PSBT under its own label', async () => {
        const { utils, calls } = await driveToResult({
            source: 'hd',
            result: { signedPsbtHex: 'bb11', txHex: '', txid: '' },
        });
        expect(calls.some((c) => c.method === 'signPsbtUserInitiated')).toBe(true);

        const psbtBlock = utils.queryByTestId('signed-psbt-hex');
        expect(psbtBlock).toBeTruthy();
        expect(psbtBlock.textContent).toBe('bb11');
        expect(utils.queryByTestId('signed-tx-hex')).toBe(null);
        expect(utils.container.textContent).toContain('Signed PSBT (hex)');
        expect(utils.container.textContent).toContain('next cosigner');
    });

    it('renders BOTH blocks, distinctly labeled, when a lane returns both', async () => {
        const { utils } = await driveToResult({
            source: 'hd',
            result: { signedPsbtHex: 'bb11', txHex: 'cc22', txid: 'dd33' },
        });
        expect(utils.queryByTestId('signed-psbt-hex').textContent).toBe('bb11');
        expect(utils.queryByTestId('signed-tx-hex').textContent).toBe('cc22');
        expect(utils.container.textContent).toContain('Signed PSBT (hex)');
        expect(utils.container.textContent).toContain('Signed transaction (raw hex)');
    });
});
