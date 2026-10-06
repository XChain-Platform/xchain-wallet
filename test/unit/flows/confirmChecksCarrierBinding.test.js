// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The chunk-lane carrier check hands the SDK verifier the caller's ORIGINAL rawData
// and whether the encoder stored its deflated form.

import { describe, it, expect, vi } from 'vitest';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { checkCarrierScripts, assertNoTamper, TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

const OK = { ok: true, reason: null, checked: 1 };

describe('checkCarrierScripts payload binding', () => {
    it('forwards rawData and the compressed flag to the verifier', () => {
        const verify = vi.fn(() => OK);
        checkCarrierScripts({
            psbt: 'p', carrierScripts: ['aa'], encoding: 'P2SH', actionString: 'A',
            rawData: 'original', rawDataCompressed: true, network: 'n', verifyCarrierScripts: verify,
        });
        const args = verify.mock.calls[0][0];
        expect(args.rawData).toBe('original');
        expect(args.rawDataCompressed).toBe(true);
    });

    it('treats an absent compressed flag as false and keeps null rawData as null', () => {
        const verify = vi.fn(() => OK);
        checkCarrierScripts({
            psbt: 'p', carrierScripts: ['aa'], encoding: 'P2WSH', actionString: 'A',
            rawData: null, verifyCarrierScripts: verify,
        });
        const args = verify.mock.calls[0][0];
        expect(args.rawData).toBeNull();
        expect(args.rawDataCompressed).toBe(false);
    });

    it('does not call the verifier off the chunk lanes', () => {
        const verify = vi.fn(() => OK);
        const r = checkCarrierScripts({ encoding: 'OP_RETURN', rawData: 'x', verifyCarrierScripts: verify });
        expect(r.skipped).toBe(true);
        expect(verify).not.toHaveBeenCalled();
    });

    it('a verifier payload mismatch on the rawData push blocks as tamper', () => {
        const verify = vi.fn(({ rawData }) => (rawData === 'approved'
            ? { ok: false, reason: 'PAYLOAD_MISMATCH', checked: 1 } : OK));
        const expected = { addressed: [], encoding: 'P2SH', carrierAllowance: 1 };
        expect(() => assertNoTamper({
            psbtHex: 'p', expected, ownAddresses: [],
            decomposePsbt: () => ({ outputs: [{ address: null, scriptPubKeyHex: 'a9', scriptType: 'p2sh', value: 546 }] }),
            actionString: 'A', decodeActionFromPsbt: () => ({ ok: true }),
            psbt: 'p', carrierScripts: ['aa'], rawData: 'approved', rawDataCompressed: false,
            network: 'n', verifyCarrierScripts: verify,
        })).toThrow(TamperDetectedError);
    });
});

describe('composeActionForConfirm carrier binding', () => {
    const ACTION = 'FILE|0|a.txt|text/plain';
    const WRITTEN = 'FILE|0|a.txt|text/plain|||||||1';

    function harness(compression) {
        const verifyCarrierScripts = vi.fn(() => OK);
        const sdk = {
            encoder: {
                createTx: vi.fn(async () => ({
                    psbt: 'PSBTHEX', encoding: 'P2SH', carrierScripts: ['aa11'],
                    ...(compression ? { compression } : {}),
                })),
            },
            actions: { createAction: vi.fn(() => ({ actionString: ACTION, action: 'FILE', version: 0 })) },
            wallet: {
                decomposePsbt: vi.fn(() => ({
                    outputs: [
                        { address: null, scriptPubKeyHex: `a914${'11'.repeat(20)}87`, scriptType: 'p2sh', value: 546 },
                        { address: 'chg', scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 100 },
                    ],
                })),
            },
            decoder: {
                decodeActionStringFromPsbt: vi.fn(() => ({ ok: true, actionString: ACTION })),
                describe: vi.fn(() => ({ summary: 's', details: [], warnings: [] })),
                verifyCarrierScripts,
            },
            config: { network: 'regtest' },
        };
        return {
            verifyCarrierScripts,
            args: {
                vault: { settings: { get: async () => ({ ads: { enabled: false, perChain: {} } }) } },
                chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest', adsDonationAddress: 'XXXX' }) },
                sdkRegistry: { get: () => sdk },
                chainId: 'btc',
                actionData: { action: 'FILE', params: {} },
                encoderOpts: { pubkey: 'pub', rawData: 'ORIGINAL-BYTES' },
                source: 'chg',
                ownAddresses: ['chg'],
            },
        };
    }

    it('passes the caller rawData, not the stored form, when the encoder compressed', async () => {
        const h = harness({ compressed: true, data: WRITTEN, rawData: 'DEFLATED' });
        await composeActionForConfirm(h.args);
        const args = h.verifyCarrierScripts.mock.calls[0][0];
        expect(args.rawData).toBe('ORIGINAL-BYTES');
        expect(args.rawDataCompressed).toBe(true);
        expect(args.actionString).toBe(WRITTEN);
    });

    it('passes compressed false when the encoder stored the bytes as given', async () => {
        const h = harness(null);
        await composeActionForConfirm(h.args);
        const args = h.verifyCarrierScripts.mock.calls[0][0];
        expect(args.rawData).toBe('ORIGINAL-BYTES');
        expect(args.rawDataCompressed).toBe(false);
    });

    it('passes null rawData when the caller supplied none', async () => {
        const h = harness(null);
        delete h.args.encoderOpts.rawData;
        await composeActionForConfirm(h.args);
        expect(h.verifyCarrierScripts.mock.calls[0][0].rawData).toBeNull();
    });
});
