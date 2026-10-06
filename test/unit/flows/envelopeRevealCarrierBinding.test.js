// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The envelope reveal check runs the SDK carrier binding rule after its own
// structural checks, and a throw from that rule refuses the reveal.

import { describe, it, expect, vi } from 'vitest';
import { checkEnvelopeReveal } from '../../../packages/core/src/flows/envelopeRevealCheck.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

const ACTION = 'FILE|0|big.bin|application/octet-stream|Taproot test||';
const SOURCE = 'bcrt1qsource';
const COMMIT_SCRIPT = `5120${'ee'.repeat(32)}`;
const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32), commitVout: 0, commitValue: 60000, commitAddress: 'bcrt1pcommit',
    internalPubkey: 'bb'.repeat(32), tapleafHash: 'cc'.repeat(32),
});
const COMMIT = Object.freeze({
    inputs: [{ prevTxHash: 'ff'.repeat(32), prevTxIndex: 1, value: 100000, scriptPubKeyHex: '0014', address: SOURCE }],
    outputs: [
        { address: ENVELOPE.commitAddress, scriptPubKeyHex: COMMIT_SCRIPT, scriptType: 'p2tr', value: 60000 },
        { address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 39000 },
    ],
});
const REVEAL = Object.freeze({
    inputs: [{ prevTxHash: ENVELOPE.commitTxid, prevTxIndex: 0, value: 60000, scriptPubKeyHex: COMMIT_SCRIPT }],
    outputs: [{ address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 546 }],
});

const base = (extra = {}) => ({
    commit: COMMIT, reveal: REVEAL, envelope: ENVELOPE, ownAddresses: [SOURCE], actionString: ACTION,
    decodeRevealAction: () => ({ ok: true, actionString: ACTION }),
    revealPsbt: 'REVEAL', network: 'regtest',
    ...extra,
});

describe('checkEnvelopeReveal carrier binding', () => {
    it('accepts a reveal the binding rule passes and hands it the reveal, action and network', () => {
        const assertEnvelopeCarrierBinding = vi.fn();
        expect(checkEnvelopeReveal(base({ assertEnvelopeCarrierBinding }))).toEqual({ ok: true });
        expect(assertEnvelopeCarrierBinding).toHaveBeenCalledWith({
            revealPsbt: 'REVEAL', actionString: ACTION, network: 'regtest',
        });
    });

    it('refuses a substituted reveal the binding rule rejects', () => {
        const assertEnvelopeCarrierBinding = vi.fn(() => { throw new Error('CARRIER_ACTION_MISMATCH'); });
        expect(checkEnvelopeReveal(base({ assertEnvelopeCarrierBinding })))
            .toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('refuses when no binding rule is supplied', () => {
        expect(checkEnvelopeReveal(base({ assertEnvelopeCarrierBinding: undefined })))
            .toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('does not reach the binding rule when a structural check already refused', () => {
        const assertEnvelopeCarrierBinding = vi.fn();
        const verdict = checkEnvelopeReveal(base({ ownAddresses: ['bcrt1qother'], assertEnvelopeCarrierBinding }));
        expect(verdict.reason).toBe('REVEAL_PAYS_FOREIGN_ADDRESS');
        expect(assertEnvelopeCarrierBinding).not.toHaveBeenCalled();
    });
});

describe('composeActionForConfirm carrier binding', () => {
    const decomposed = { COMMIT, REVEAL };
    function harness(assertEnvelopeCarrierBinding) {
        const sdk = {
            config: { network: 'regtest' },
            encoder: {
                createTx: vi.fn(async () => ({
                    psbt: 'COMMIT', encoding: 'TAPROOT', revealPsbt: 'REVEAL', envelope: { ...ENVELOPE },
                })),
            },
            actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'FILE', version: 0 })) },
            wallet: { decomposePsbt: vi.fn((hex) => decomposed[hex]) },
            decoder: {
                decodeActionStringFromPsbt: vi.fn(() => ({ ok: false, reason: 'NO_ACTION' })),
                decodeActionFromPsbt: vi.fn(() => ({ ok: true, actionString: ACTION })),
                describe: vi.fn(() => ({ summary: 'described', details: [], warnings: [] })),
                assertEnvelopeCarrierBinding,
            },
        };
        return {
            vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
            chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', addressTypes: ['p2tr'] }) },
            sdkRegistry: { get: () => sdk },
            chainId: 'bitcoin-regtest',
            actionData: { action: 'FILE', params: {} },
            encoderOpts: { pubkey: `02${'11'.repeat(32)}`, rawData: 'x'.repeat(51200), encoding: 'AUTO' },
            source: SOURCE,
            ownAddresses: [SOURCE],
            signer: { source: 'hd' },
        };
    }

    it('passes the SDK rule through and composes when it accepts', async () => {
        const rule = vi.fn();
        const composed = await composeActionForConfirm(harness(rule));
        expect(composed.tamperVerified).toBe(true);
        expect(rule).toHaveBeenCalledWith({ revealPsbt: 'REVEAL', actionString: ACTION, network: 'regtest' });
    });

    it('refuses with a tamper error when the SDK exposes no rule', async () => {
        const err = await composeActionForConfirm(harness(undefined)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_CARRIER_BINDING');
    });

    it('refuses with a tamper error when the SDK rule rejects the reveal', async () => {
        const rule = vi.fn(() => { throw new Error('CARRIER_ACTION_MISMATCH'); });
        const err = await composeActionForConfirm(harness(rule)).catch((e) => e);
        expect(err).toBeInstanceOf(TamperDetectedError);
        expect(err.details.reason).toBe('REVEAL_CARRIER_BINDING');
    });
});
