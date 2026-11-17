// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// coinpayAction has no confirm screen, so the PSBT the encoder service returns
// is signed straight away, for the manual pay button and the auto-pay watcher
// alike (the watcher calls coinpayAction). The built transaction is held to the
// confirm pipeline's tamper checks before any signer runs: the payee output at
// the exact amount, the COINPAY carrier, change back to the payer, nothing else.
// The encoder here is a fake whose answer each case controls.

import { describe, it, expect, vi } from 'vitest';
import { coinpayAction } from '../../../packages/core/src/flows/coinpayAction.js';

const PAYER = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
const PAYEE = 'n2eMqTT929pb1RDNuqEnxdaLau1rxy3efi';
const ATTACKER = 'mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef';
const ACTION_STRING = 'COINPAY|0|4242';

const OBLIGATION = {
    action_index: '4242',
    payer_address: PAYER,
    payee_address: PAYEE,
    coin_amount: '0.0025',
    coinpay_status: 'pending_coinpay',
    expiration: Math.floor(Date.now() / 1000) + 3600,
};
const OPRETURN = { address: null, scriptPubKeyHex: '6a0e434f494e504159', scriptType: 'unknown', value: 0 };
const CHANGE = { address: PAYER, scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 90000 };
const out = (address, value) => ({ address, scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value });

function harness({ outputs, decoded }) {
    const sdk = {
        config: { network: 'testnet' },
        getCoinpayObligations: async () => [OBLIGATION],
        actions: { createAction: vi.fn(() => ({ actionString: ACTION_STRING, action: 'COINPAY', version: 0 })) },
        encoder: {
            createTx: vi.fn(async () => ({ psbt: 'BUILT', encoding: 'OP_RETURN' })),
            broadcastTx: vi.fn(async () => ({})),
        },
        wallet: { decomposePsbt: vi.fn(() => ({ inputs: [{}], outputs })) },
        decoder: {
            decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: decoded ?? ACTION_STRING })),
        },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        sdk,
        signer,
        run: () => coinpayAction({
            vault: {
                pendingTxs: { list: async () => [] },
                settings: { get: async () => ({}) },
            },
            walletId: 'w1',
            signer,
            chainRegistry: { get: () => ({ id: 'bitcoin-testnet', coin: 'bitcoin', networkKind: 'testnet' }) },
            sdkRegistry: { get: () => sdk },
            chainId: 'bitcoin-testnet',
            from: { address: PAYER, publicKey: '02'.padEnd(66, 'a'), derivationPath: "m/44'/1'/0'/0/0" },
            orderMatchActionIndex: '4242',
            payeeAddress: PAYEE,
            coinAmount: 250000,
            trackPendingTx: false,
        }),
    };
}

async function expectRefusedUnsigned(h, pattern) {
    await expect(h.run()).rejects.toMatchObject({ name: 'TamperDetectedError', message: expect.stringMatching(pattern) });
    expect(h.signer.signPsbt).not.toHaveBeenCalled();
    expect(h.sdk.encoder.broadcastTx).not.toHaveBeenCalled();
}

describe('coinpayAction holds the built transaction to the approved payment', () => {
    it('signs a correct COINPAY build: payee at the exact amount, the carrier, change to the payer', async () => {
        const h = harness({ outputs: [out(PAYEE, '250000'), OPRETURN, CHANGE] });
        await h.run();
        expect(h.signer.signPsbt).toHaveBeenCalledTimes(1);
        expect(h.signer.signPsbt.mock.calls[0][0].psbtHex).toBe('BUILT');
        expect(h.sdk.decoder.decodeActionStringFromPsbt).toHaveBeenCalled();
    });

    it('refuses a swapped payee', async () => {
        await expectRefusedUnsigned(
            harness({ outputs: [out(ATTACKER, '250000'), OPRETURN, CHANGE] }),
            /did not approve/,
        );
    });

    it('refuses a changed amount', async () => {
        await expectRefusedUnsigned(
            harness({ outputs: [out(PAYEE, '25000'), OPRETURN, CHANGE] }),
            /did not approve/,
        );
    });

    it('refuses an extra output to a foreign address', async () => {
        await expectRefusedUnsigned(
            harness({ outputs: [out(PAYEE, '250000'), out(ATTACKER, 20000), OPRETURN, CHANGE] }),
            /did not approve/,
        );
    });

    it('refuses a COINPAY carrier that names another match', async () => {
        await expectRefusedUnsigned(
            harness({ outputs: [out(PAYEE, '250000'), OPRETURN, CHANGE], decoded: 'COINPAY|0|9999' }),
            /does not match what you approved/,
        );
    });
});

describe('the auto-pay watcher verifies through the same flow', () => {
    it('defaults to coinpayAction, so every automatic payment gets the built-transaction check', async () => {
        const { CoinpayAutopayWatcher } = await import('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js');
        const watcher = new CoinpayAutopayWatcher({
            vault: {}, sdkRegistry: {}, chainRegistry: {}, getSigner: () => null,
            getSettings: async () => ({}), reservationLedger: {}, notify: async () => {},
            shellKind: 'web', intervalMs: 60_000, now: () => 0,
        });
        expect(watcher._coinpayAction).toBe(coinpayAction);
    });

    it('never hands coinpayAction a prebuilt PSBT, which would skip the build and the check', async () => {
        const src = (await import('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js?raw')).default;
        expect(src).toContain('coinpayAction');
        expect(src).not.toMatch(/prebuiltPsbt/);
    });
});
