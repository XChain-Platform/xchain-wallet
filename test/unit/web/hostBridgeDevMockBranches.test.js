// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';

describe('host bridge dev mock branches', () => {
    it('serves chain-aware read methods and empty unsupported query shapes', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'litecoin-mainnet' });

        expect((await sdk.getBalances('ltc1-source')).data).not.toHaveLength(0);
        expect(await sdk.getAddress('ltc1-source')).toEqual(expect.objectContaining({
            address: 'ltc1-source',
            balances: { confirmed: '30.00000000' },
        }));
        expect(await sdk.getToken('LITEGEM')).toEqual(expect.objectContaining({ tick: 'LITEGEM' }));
        expect(await sdk.getToken('MISSING')).toBeNull();
        expect(await sdk.getTokens('ltc1-source', 'address')).not.toHaveLength(0);
        expect(await sdk.getTokens('LITEGEM', 'subtoken')).toEqual(expect.any(Array));
        expect(await sdk.getTokens('', 'subtoken')).toEqual([]);
        expect(await sdk.getTokens('LITE', 'token')).toEqual([]);
        expect(await sdk.getIssues('LITEGEM', 'token')).not.toHaveLength(0);
        expect(await sdk.getIssues('', 'token')).toEqual([]);
        expect(await sdk.getIssues('LITEGEM', 'address')).toEqual([]);

        for (const method of ['getDispensers', 'getOrders', 'getSwaps', 'getHistory']) {
            expect(await sdk[method]('LITEGEM', 'token')).not.toHaveLength(0);
            expect(await sdk[method]('', 'token')).toEqual([]);
            expect(await sdk[method]('LITEGEM', 'address')).toEqual([]);
        }

        expect(await sdk.getHolders('LITEGEM')).toEqual(expect.objectContaining({
            tick: 'LITEGEM',
            total: 12,
            data: expect.arrayContaining([
                expect.objectContaining({ address: expect.any(String), amount: expect.any(String) }),
            ]),
        }));
        expect(await sdk.getHolders('')).toEqual([]);
        expect(await sdk.getUnknownResource()).toEqual([]);
        expect(sdk.unknownResource).toBeUndefined();
    });

    it('covers wallet validation, codec, and signing failure paths', async () => {
        const sdk = __createDevMockSdkForTests();
        const address = sdk.wallet.deriveAddress('02'.padEnd(66, '1'));

        expect(address).toEqual(expect.any(String));
        expect(sdk.wallet.deriveAddress('02'.padEnd(66, '2'), { type: 'p2wpkh' })).toEqual(expect.any(String));
        expect(sdk.wallet.validateAddress(address).valid).toBe(true);
        expect(sdk.wallet.validateAddress('').valid).toBe(false);
        expect(() => sdk.wallet.signPsbt()).toThrow('signing requires');
        await expect(sdk.wallet.broadcastTx()).rejects.toThrow('broadcast requires');
        expect(() => sdk.wallet.importWIF()).toThrow('WIF import requires');

        const action = sdk.actions.createAction({ action: 'SEND', params: { TICK: 'XCP', AMOUNT: '1' } });
        const broadcast = sdk.actions.createAction({
            action: 'BROADCAST',
            params: { MESSAGE: 'hello', VALUE: '', FEE: null, MEMO: undefined },
        });
        expect(action.actionString).toContain('SEND');
        expect(broadcast.actionString).toBe('BROADCAST|0|hello');

        const withAction = await sdk.encoder.createTx({
            data: action.actionString,
            pubkey: '02'.padEnd(66, '3'),
            customOutputs: [{ address: 'bc1-destination', value: '25' }],
            change: 'bc1-change',
        });
        const decoded = sdk.wallet.decomposePsbt(withAction.psbt);
        expect(decoded.outputs).toHaveLength(3);
        expect(sdk.decoder.decodeActionFromPsbt(withAction.psbt)).toEqual({ ok: true, actionString: action.actionString });

        const withoutAction = await sdk.encoder.createTx({ data: '', pubkey: '02'.padEnd(66, '4'), customOutputs: null });
        expect(sdk.wallet.decomposePsbt(withoutAction.psbt).outputs).toHaveLength(1);
        expect(sdk.wallet.decomposePsbt('devmockpsbt:{')).toEqual({ inputs: [], outputs: [] });
        expect(sdk.decoder.decodeActionStringFromPsbt('invalid')).toEqual({ ok: false, reason: 'decode-failed' });
        await expect(sdk.encoder.broadcastTx()).rejects.toThrow('broadcast requires');
    });

    it('returns pass and fail preflight verdicts and inert service methods', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-mainnet' });
        const fail = await sdk.preflight('SEND|0|BTC|999999|bc1-destination', { source: 'bc1-source' });
        const pass = await sdk.preflight('SEND|0|MISSING|not-a-number|bc1-destination', {});

        expect(fail.verdict).toBe('fail');
        expect(fail.findings).toContainEqual(expect.objectContaining({ code: 'BALANCE_INSUFFICIENT', overridable: true }));
        expect(pass.verdict).toBe('pass');
        expect(() => sdk.auth.signMessage()).toThrow('message signing requires');
        expect(sdk.auth.verifyMessage()).toBe(false);
        expect(sdk.auth.generateChallenge()).toBe('');
        await expect(sdk.connectWs()).resolves.toBeUndefined();
        expect(sdk.disconnectWs()).toBeUndefined();
        expect(sdk.onOrderMatch()).toEqual(expect.any(Function));
        expect(sdk.onDispenser()).toEqual(expect.any(Function));
        expect(sdk.onCoinpayRequired()).toEqual(expect.any(Function));
        expect(await sdk.getUnconfirmed('bc1-source', { limit: 1 })).toEqual(expect.any(Array));
    });

    it('distinguishes mock-derived and first-contact public keys', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'dogecoin-mainnet' });
        const address = sdk.wallet.deriveAddress('02'.padEnd(66, '5'));
        const onAddress = vi.fn();
        const onMempool = vi.fn();
        const unsubscribeAddress = sdk.onAddress(address, onAddress);
        const unsubscribeMempool = sdk.onMempoolAction(address, onMempool);

        expect(await sdk.getPublicKey(address)).toEqual(expect.any(String));
        expect(await sdk.getPublicKey('D-real-first-contact')).toBeNull();
        expect(unsubscribeAddress).toEqual(expect.any(Function));
        expect(unsubscribeMempool).toEqual(expect.any(Function));
        unsubscribeAddress();
        unsubscribeMempool();
    });
});

describe('host bridge dev mock agent accounts', () => {
    it('derives a deterministic aggregate address for an agent key pair', () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-mainnet' });
        const agent = `02${'ab'.repeat(32)}`;
        const wallet = `03${'cd'.repeat(32)}`;
        const first = sdk.coSigner.deriveMuSig2P2TR([agent, wallet]);
        expect(first.address).toMatch(/^bc1p/);
        expect(sdk.coSigner.deriveMuSig2P2TR([agent, wallet]).address).toBe(first.address);
        expect(sdk.coSigner.deriveMuSig2P2TR([wallet, agent]).address).not.toBe(first.address);
    });
});
