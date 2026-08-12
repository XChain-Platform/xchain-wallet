// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// submitWithSigner puts the native-coin protocol fee on the
// transaction that carries the ACTION, and still declares it to the phase-1
// build so the reveal can afford it.
//
// Both halves are load-bearing and they pull in opposite directions:
//   - emitted on the COMMIT, the indexer (which reads the reveal's outputs)
// rejects the action for not paying, and the fee is spent anyway;
//   - withheld from the phase-1 BUILD, the encoder reserves nothing in the
//     script output the reveal spends, and the reveal cannot balance
//     ("Outputs are spending more than Inputs") once the quote outgrows the
// Commit's incidental slack (measured on litecoin-regtest).
// So it is PASSED to createTx and EMITTED on spendP2sh, and only ever paid once
// because the encoder skips emitting customOutputs on a chunk-lane commit.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const FEE_DEST = 'mfeesJdVLx23zhtsCveA8EEfmHX7qSV2Ls';
const FEE_SATS = 6946667;

function makeHarness({ encoding = 'P2SH', requiredFeeSats = FEE_SATS } = {}) {
    const createTx = vi.fn(async () => ({ psbt: 'COMMIT-PSBT', encoding }));
    const spendP2sh = vi.fn(async () => ({ psbt: 'REVEAL-PSBT' }));
    const broadcastTx = vi.fn(async () => ({}));
    const createAction = vi.fn(() => ({
        actionString: `DEPLOY|0|${'Q'.repeat(400)}|100000`, action: 'DEPLOY', version: 0,
    }));
    const sdk = {
        encoder: { createTx, spendP2sh, broadcastTx },
        actions: { createAction },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        quoteNativeFee: vi.fn(async () => ({
            supported: true, valid: null, feeDestination: FEE_DEST, requiredFeeSats,
        })),
    };
    const signer = {
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        sdk, signer, createTx, spendP2sh, signPsbt: signer.signPsbt,
        args: {
            sdkRegistry: { get: () => sdk },
            chainId: 'litecoin-regtest',
            actionData: { action: 'DEPLOY', params: { VERSION: '0', CODE: 'x', GAS_LIMIT: '100000' } },
            encoderOpts: { pubkey: 'pub', change: 'chg', payFeeInNativeCoin: true },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        },
    };
}

describe('submitWithSigner native-fee placement on the chunk lane', () => {

    it('declares the fee output to the phase-1 build so the commit reserves its value', async () => {
        const h = makeHarness();
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: FEE_DEST, value: FEE_SATS });
    });

    it('emits it on the reveal, the transaction the indexer checks', async () => {
        const h = makeHarness();
        await submitWithSigner(h.args);
        expect(h.spendP2sh).toHaveBeenCalledOnce();
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }]);
    });

    // A P2WSH payload is the same two-phase shape as P2SH.
    it('treats P2WSH the same way', async () => {
        const h = makeHarness({ encoding: 'P2WSH' });
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }]);
    });

    // Single-transaction encodings have no reveal to move it to, and the
    // transaction just built already carries it.
    it('leaves it on the only transaction when the encoder chose OP_RETURN', async () => {
        const h = makeHarness({ encoding: 'OP_RETURN' });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: FEE_DEST, value: FEE_SATS });
        expect(h.spendP2sh).not.toHaveBeenCalled();
    });

    // A free action has no output to place, and a zero-value one would be dust.
    it('adds no output at all for a zero fee', async () => {
        const h = makeHarness({ requiredFeeSats: 0 });
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs).toEqual([]);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs).toBeUndefined();
    });
});

// a later change moved the PROTOCOL FEE to the reveal and nothing else, and the gap is a
// money leak rather than a rejection: the encoder emits NO custom output on a
// chunk-lane commit (it folds each one's value and reveal-side byte cost into the
// script output), so any output the reveal is not handed was paid for and then
// burned as miner fee. Measured on Litecoin regtest 2026-07-31: a Mode B dispenser
// reserved 0.05005464 LTC and the reveal spent every satoshi of it as fee, so the
// oracle operator was not paid and the create indexed
// `invalid: ORACLE_ADDRESS (missing oracle fee output)`.
describe('submitWithSigner carries the WHOLE deferred set to the reveal', () => {

    const ORACLE = 'rltc1qguj32tkf0lx9dtr3pgega4rxjl980rjdh8h6la';
    const ORACLE_SATS = 5000000;

    // A Mode B dispenser: FIAT_CODE + ORACLE_ADDRESS, no FIAT_AMOUNT. Its action
    // string always names a full address (a ^id reference is refused, since the
    // decoder could not match the fee output), which is why this action is on the
    // chunk lane in practice rather than by contrivance.
    function makeModeBHarness({ requiredFeeSats = 0 } = {}) {
        const h = makeHarness({ requiredFeeSats });
        h.sdk.explorer = {
            getOracleFeeQuote: vi.fn(async () => ({
                valid: true, oracleAddress: ORACLE, requiredFeeSats: ORACLE_SATS, belowDust: false,
            })),
        };
        h.sdk.actions.createAction = vi.fn(() => ({
            actionString: `DISPENSER|0|LTC|XCHAIN|5||100|LTC||0||USD||${ORACLE}|||`,
            action: 'DISPENSER', version: 0,
        }));
        h.args.actionData = {
            action: 'DISPENSER',
            params: {
                VERSION: '0', GIVE_COIN: 'LTC', GIVE_TICK: 'XCHAIN', GIVE_AMOUNT: '5',
                GIVE_ESCROW: '100', GET_COIN: 'LTC', GET_AMOUNT: '0',
                FIAT_CODE: 'USD', ORACLE_ADDRESS: ORACLE,
            },
        };
        return h;
    }

    it('emits the oracle usage fee on the reveal, not just the protocol fee', async () => {
        const h = makeModeBHarness();
        await submitWithSigner(h.args);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: ORACLE, value: ORACLE_SATS });
    });

    it('still declares it to the phase-1 build, or the reveal cannot afford it', async () => {
        // that other half. The reveal's only input is the commit's script
        // output, so an output emitted there has to be paid for out of value the
        // commit reserved.
        const h = makeModeBHarness();
        await submitWithSigner(h.args);
        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toContainEqual({ address: ORACLE, value: ORACLE_SATS });
    });

    it('carries the protocol fee AND the oracle fee together', async () => {
        const h = makeModeBHarness({ requiredFeeSats: FEE_SATS });
        await submitWithSigner(h.args);
        const outs = h.spendP2sh.mock.calls[0][0].customOutputs;
        expect(outs).toContainEqual({ address: FEE_DEST, value: FEE_SATS });
        expect(outs).toContainEqual({ address: ORACLE, value: ORACLE_SATS });
        // Once each: a duplicate would double-charge the payer for the same fee.
        expect(outs.filter((o) => o.address === ORACLE)).toHaveLength(1);
        expect(outs.filter((o) => o.address === FEE_DEST)).toHaveLength(1);
    });

    it('a prebuilt PSBT carries its deferred set through the confirm envelope', async () => {
        // The signing path a real form takes: composeForConfirm built and
        // tamper-checked the commit, so nothing is rebuilt here and the deferred
        // set is whatever rode the envelope. A composer that sends only the older
        // deferredFeeOutput must still work.
        const h = makeModeBHarness();
        await submitWithSigner({
            ...h.args,
            prebuiltPsbt: {
                psbtHex: 'COMMIT-PSBT', encoding: 'P2SH', actionString: 'DISPENSER|0|...', version: 0,
                deferredFeeOutput: { address: FEE_DEST, value: FEE_SATS },
                deferredOutputs: [
                    { address: FEE_DEST, value: FEE_SATS },
                    { address: ORACLE, value: ORACLE_SATS },
                ],
            },
        });
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }, { address: ORACLE, value: ORACLE_SATS }]);
    });

    it('falls back to the fee alone when the envelope predates the whole-set field', async () => {
        const h = makeModeBHarness();
        await submitWithSigner({
            ...h.args,
            prebuiltPsbt: {
                psbtHex: 'COMMIT-PSBT', encoding: 'P2SH', actionString: 'DEPLOY|0|...', version: 0,
                deferredFeeOutput: { address: FEE_DEST, value: FEE_SATS },
            },
        });
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([{ address: FEE_DEST, value: FEE_SATS }]);
    });
});
