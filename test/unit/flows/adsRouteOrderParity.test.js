// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { composeForConfirm } from '../../../packages/core/src/flows/composeForConfirm.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const CHAIN_ID = 'bitcoin-regtest';
const SOURCE = 'bcrt1qsource';
const EXISTING = { address: 'bcrt1qrecipient', value: 7000 };
const NATIVE_FEE = { address: 'bcrt1qprotocolfee', value: 6000 };
const ORACLE_FEE = { address: 'bcrt1qoracle', value: 3000 };
const DONATION = { address: 'bcrt1qdonation', value: 5000 };
const ACTION_DATA = {
    action: 'DISPENSER',
    params: {
        GIVE_ESCROW: '10',
        GIVE_COIN: 'BTC',
        GET_COIN: 'BTC',
        ORACLE_ADDRESS: ORACLE_FEE.address,
    },
};

function harness({ encoding = 'OP_RETURN' } = {}) {
    let settings = {
        ads: {
            enabled: true,
            perChain: {
                [CHAIN_ID]: {
                    accumulatedSats: DONATION.value,
                    triggerAmountSats: 1000,
                    perTxAmountSats: 1,
                    lifetimeTxCount: 0,
                    lifetimeDonatedSats: 0,
                },
            },
        },
    };
    const createTx = vi.fn(async () => ({ psbt: 'COMMIT-PSBT', encoding }));
    const spendP2sh = vi.fn(async () => ({ psbt: 'REVEAL-PSBT' }));
    const sdk = {
        actions: {
            createAction: vi.fn(() => ({
                actionString: 'DISPENSER|0|10|BTC|BTC|bcrt1qoracle',
                action: 'DISPENSER',
                version: 0,
            })),
        },
        encoder: {
            createTx,
            spendP2sh,
            broadcastTx: vi.fn(async () => undefined),
        },
        explorer: {
            getOracleFeeQuote: vi.fn(async () => ({
                valid: true,
                belowDust: false,
                requiredFeeSats: ORACLE_FEE.value,
                oracleAddress: ORACLE_FEE.address,
            })),
        },
        quoteNativeFee: vi.fn(async () => ({
            supported: true,
            valid: true,
            requiredFeeSats: NATIVE_FEE.value,
            feeDestination: NATIVE_FEE.address,
        })),
        wallet: {
            getBitcoinNetwork: () => ({ dustThreshold: 546 }),
            decomposePsbt: (psbt) => psbt === 'REVEAL-PSBT'
                ? {
                    inputs: [{
                        prevTxHash: 'a'.repeat(64),
                        prevTxIndex: 0,
                        scriptType: 'p2sh',
                        redeemScriptHex: '0100',
                    }],
                    outputs: [],
                }
                : { inputs: [{}], outputs: [{ scriptType: 'p2sh' }] },
        },
    };
    const descriptor = {
        coin: 'BTC',
        networkKind: 'regtest',
        adsDonationAddress: DONATION.address,
        feeStrategy: { rbfSupported: true },
    };
    return {
        createTx,
        spendP2sh,
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => descriptor },
        vault: {
            settings: {
                get: async () => settings,
                put: async (next) => { settings = next; },
            },
        },
    };
}

function encoderOpts() {
    return {
        pubkey: '02'.padEnd(66, '1'),
        sourceAddress: SOURCE,
        change: SOURCE,
        payFeeInNativeCoin: true,
        customOutputs: [{ ...EXISTING }],
    };
}

describe('ADS output order parity', () => {
    it('places protocol fees before ADS in atomic and confirmation composition', async () => {
        const composedHarness = harness();
        await composeForConfirm({
            ...composedHarness,
            chainId: CHAIN_ID,
            actionData: ACTION_DATA,
            encoderOpts: encoderOpts(),
            source: SOURCE,
        });

        const atomicHarness = harness();
        await submitAction({
            ...atomicHarness,
            walletId: 'wallet-1',
            chainId: CHAIN_ID,
            actionData: ACTION_DATA,
            encoderOpts: encoderOpts(),
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            signer: {
                kind: 'software',
                signPsbt: vi.fn(async () => ({
                    signedPsbtHex: '70736274ff',
                    txHex: '02000000',
                    txid: 'a'.repeat(64),
                })),
            },
        });

        const composedOutputs = composedHarness.createTx.mock.calls[0][0].customOutputs;
        const atomicOutputs = atomicHarness.createTx.mock.calls[0][0].customOutputs;
        expect(composedOutputs).toEqual([EXISTING, NATIVE_FEE, ORACLE_FEE, DONATION]);
        expect(atomicOutputs).toEqual(composedOutputs);
    });

    it('keeps the ordered output set visible to an atomic chunk reveal', async () => {
        const h = harness({ encoding: 'P2SH' });
        await submitAction({
            ...h,
            walletId: 'wallet-1',
            chainId: CHAIN_ID,
            actionData: ACTION_DATA,
            encoderOpts: encoderOpts(),
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
            signer: {
                kind: 'software',
                signPsbt: vi.fn(async ({ psbtHex }) => ({
                    signedPsbtHex: psbtHex,
                    txHex: `TX(${psbtHex})`,
                    txid: psbtHex === 'COMMIT-PSBT' ? 'a'.repeat(64) : 'b'.repeat(64),
                })),
            },
        });

        expect(h.createTx.mock.calls[0][0].customOutputs)
            .toEqual([EXISTING, NATIVE_FEE, ORACLE_FEE, DONATION]);
        expect(h.spendP2sh.mock.calls[0][0].customOutputs)
            .toEqual([EXISTING, NATIVE_FEE, ORACLE_FEE, DONATION]);
    });
});
