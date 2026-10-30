// Copyright (c) 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { submitAction } = vi.hoisted(() => ({ submitAction: vi.fn() }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({ submitAction }));

import { airdropAction } from '../../../packages/core/src/flows/airdropAction.js';
import { dividendAction, holdersFor } from '../../../packages/core/src/flows/dividendAction.js';
import { issueToken } from '../../../packages/core/src/flows/issueToken.js';
import { mintToken } from '../../../packages/core/src/flows/mintToken.js';

const FROM = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(params, extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

function submission() {
    return submitAction.mock.calls.at(-1)[0];
}

beforeEach(() => {
    submitAction.mockReset();
    submitAction.mockResolvedValue({ txid: 'protocol-tx' });
});

describe('protocol token action input edges', () => {
    it.each([
        ['issue opts', issueToken, undefined, 'issueToken: opts is required'],
        ['issue params', issueToken, opts(null), 'issueToken: params is required'],
        ['issue ticker type', issueToken, opts({ TICK: 7 }), 'issueToken: params.TICK is required'],
        ['mint opts', mintToken, undefined, 'mintToken: opts is required'],
        ['mint params', mintToken, opts(null), 'mintToken: params is required'],
        ['mint ticker', mintToken, opts({ TICK: '', AMOUNT: '1' }), 'mintToken: params.TICK is required'],
        ['mint amount type', mintToken, opts({ TICK: 'UNIT', AMOUNT: 1 }), 'mintToken: params.AMOUNT is required'],
        ['dividend opts', dividendAction, undefined, 'dividendAction: opts is required'],
        ['dividend params', dividendAction, opts(null), 'dividendAction: params is required'],
        ['dividend ticker', dividendAction, opts({ TICK: '', DIVIDEND_TICK: 'BTC', AMOUNT: '1' }), 'dividendAction: params.TICK is required'],
        ['dividend payment ticker', dividendAction, opts({ TICK: 'UNIT', DIVIDEND_TICK: 3, AMOUNT: '1' }), 'dividendAction: params.DIVIDEND_TICK is required'],
        ['dividend amount', dividendAction, opts({ TICK: 'UNIT', DIVIDEND_TICK: 'BTC', AMOUNT: '' }), 'dividendAction: params.AMOUNT is required'],
        ['airdrop opts', airdropAction, undefined, 'airdropAction: opts is required'],
        ['airdrop params', airdropAction, opts(null), 'airdropAction: params is required'],
        ['airdrop ticker', airdropAction, opts({ TICK: '', AMOUNT: '1', LIST_ACTION_INDEX: '9' }), 'airdropAction: params.TICK is required'],
        ['airdrop amount', airdropAction, opts({ TICK: 'UNIT', AMOUNT: 1, LIST_ACTION_INDEX: '9' }), 'airdropAction: params.AMOUNT is required'],
        ['airdrop list index', airdropAction, opts({ TICK: 'UNIT', AMOUNT: '1', LIST_ACTION_INDEX: 9 }), 'airdropAction: params.LIST_ACTION_INDEX is required'],
    ])('rejects invalid %s before submission', async (_name, action, input, message) => {
        await expect(action(input)).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it.each([
        ['zero dividend amount', dividendAction,
            { TICK: 'SHARES', DIVIDEND_TICK: 'UNIT', AMOUNT: '0' },
            'dividendAction: params.AMOUNT must be a positive decimal'],
        ['negative dividend amount', dividendAction,
            { TICK: 'SHARES', DIVIDEND_TICK: 'UNIT', AMOUNT: '-1' },
            'dividendAction: params.AMOUNT must be a positive decimal'],
        ['malformed dividend amount', dividendAction,
            { TICK: 'SHARES', DIVIDEND_TICK: 'UNIT', AMOUNT: '.' },
            'dividendAction: params.AMOUNT must be a positive decimal'],
        ['malformed dividend token id', dividendAction,
            { TICK: 'SHARES', DIVIDEND_TICK: '^0', AMOUNT: '1' },
            "dividendAction: Dividend ticker can be a name, or ^ followed by the token's number (^123)."],
        ['malformed dividend holder id', dividendAction,
            { TICK: '^0', DIVIDEND_TICK: 'UNIT', AMOUNT: '1' },
            "dividendAction: Holder-of ticker can be a name, or ^ followed by the token's number (^123)."],
        ['invalid dividend memo', dividendAction,
            { TICK: 'SHARES', DIVIDEND_TICK: 'UNIT', AMOUNT: '1', MEMO: 'bad|memo' },
            'dividendAction: params.MEMO cannot contain | or ; characters'],
        ['zero airdrop amount', airdropAction,
            { TICK: 'UNIT', AMOUNT: '0', LIST_ACTION_INDEX: '9' },
            'airdropAction: params.AMOUNT must be a positive decimal'],
        ['negative airdrop amount', airdropAction,
            { TICK: 'UNIT', AMOUNT: '-1', LIST_ACTION_INDEX: '9' },
            'airdropAction: params.AMOUNT must be a positive decimal'],
        ['malformed airdrop amount', airdropAction,
            { TICK: 'UNIT', AMOUNT: '.', LIST_ACTION_INDEX: '9' },
            'airdropAction: params.AMOUNT must be a positive decimal'],
        ['malformed airdrop list id', airdropAction,
            { TICK: 'UNIT', AMOUNT: '1', LIST_ACTION_INDEX: '9x' },
            'airdropAction: params.LIST_ACTION_INDEX must be a positive integer'],
        ['zero airdrop list id', airdropAction,
            { TICK: 'UNIT', AMOUNT: '1', LIST_ACTION_INDEX: '0' },
            'airdropAction: params.LIST_ACTION_INDEX must be a positive integer'],
        ['malformed airdrop token id', airdropAction,
            { TICK: '^0', AMOUNT: '1', LIST_ACTION_INDEX: '9' },
            "airdropAction: Token ticker can be a name, or ^ followed by the token's number (^123)."],
        ['invalid airdrop memo', airdropAction,
            { TICK: 'UNIT', AMOUNT: '1', LIST_ACTION_INDEX: '9', MEMO: 'bad;memo' },
            'airdropAction: params.MEMO cannot contain | or ; characters'],
    ])('rejects %s before the encoder', async (_name, action, params, message) => {
        await expect(action(opts(params))).rejects.toThrow(message);
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('describes an ISSUE configuration without a maximum supply or transfer', async () => {
        const params = { TICK: 'UNIT', MAX_SUPPLY: '' };
        await issueToken(opts(params));

        expect(submission().actionData).toEqual({ action: 'ISSUE', params });
        expect(submission().pendingTxMeta).toEqual({
            fromAddress: FROM.address,
            toAddress: null,
            actionSummary: 'Configure token UNIT',
        });
    });

    it.each([
        [undefined, null, 'Mint 2 UNIT'],
        ['bcrt1qrecipient', 'bcrt1qrecipient', 'Mint 2 UNIT to bcrt1qrecipient'],
    ])('describes a MINT destination of %s', async (destination, toAddress, actionSummary) => {
        const params = { TICK: 'UNIT', AMOUNT: '2', ...(destination === undefined ? {} : { DESTINATION: destination }) };
        await mintToken(opts(params));

        expect(submission().actionData).toEqual({ action: 'MINT', params });
        expect(submission().pendingTxMeta).toMatchObject({ toAddress, actionSummary });
    });

    it('describes DIVIDEND and AIRDROP submissions without changing their signed params', async () => {
        const dividendParams = { TICK: 'SHARES', DIVIDEND_TICK: 'UNIT', AMOUNT: '0.5' };
        await dividendAction(opts(dividendParams));
        expect(submission().actionData).toEqual({ action: 'DIVIDEND', params: dividendParams });
        expect(submission().pendingTxMeta.actionSummary)
            .toBe('Pay 0.5 UNIT per unit of SHARES held');

        const airdropParams = { TICK: 'UNIT', AMOUNT: '4', LIST_ACTION_INDEX: '27' };
        await airdropAction(opts(airdropParams));
        expect(submission().actionData).toEqual({ action: 'AIRDROP', params: airdropParams });
        expect(submission().pendingTxMeta.actionSummary).toBe('Airdrop 4 UNIT to list #27');
    });
});

describe('holdersFor explorer response edges', () => {
    it.each([
        [{ chainId: 'c', tick: 'T' }, 'holdersFor: sdkRegistry is required'],
        [{ sdkRegistry: {}, tick: 'T' }, 'holdersFor: chainId is required'],
        [{ sdkRegistry: {}, chainId: 'c' }, 'holdersFor: tick is required'],
    ])('rejects missing query plumbing %#', async (input, message) => {
        await expect(holdersFor(input)).rejects.toThrow(message);
    });

    it('passes through the caller options when all pages are not requested', async () => {
        const response = { total: 1, data: [{ address: 'holder' }] };
        const getHolders = vi.fn(async () => response);
        const queryOpts = { page: 3, limit: 7 };

        await expect(holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'c',
            tick: 'UNIT',
            opts: queryOpts,
        })).resolves.toBe(response);
        expect(getHolders).toHaveBeenCalledWith('UNIT', queryOpts);
    });

    it('returns an array response directly in all-pages mode', async () => {
        const response = [{ address: 'holder' }];
        const getHolders = vi.fn(async () => response);

        await expect(holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'c',
            tick: 'UNIT',
            all: true,
        })).resolves.toBe(response);
        expect(getHolders).toHaveBeenCalledTimes(1);
    });

    it.each([
        [null],
        [{ data: [{ address: 'holder' }], total: 'unknown' }],
        [{ data: [{ address: 'holder' }], total: 1 }],
    ])('returns a terminal first page without requesting more pages %#', async (response) => {
        const getHolders = vi.fn(async () => response);
        await expect(holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'c',
            tick: 'UNIT',
            all: true,
        })).resolves.toBe(response);
        expect(getHolders).toHaveBeenCalledTimes(1);
    });

    const holderRows = (prefix, count) => Array.from({ length: count }, (_unused, index) => ({
        address: `${prefix}-${index}`,
    }));

    it('merges complete array pages with the caller options', async () => {
        const first = { total: 1001, data: holderRows('first', 500) };
        const getHolders = vi.fn(async (_tick, pageOpts) => {
            if (pageOpts.page === 1) return first;
            if (pageOpts.page === 2) return holderRows('second', 500);
            return { data: holderRows('third', 1) };
        });

        const result = await holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'c',
            tick: 'UNIT',
            opts: { owner: 'wallet' },
            all: true,
        });
        expect(result.total).toBe(1001);
        expect(result.data).toHaveLength(1001);
        expect(result.data[500]).toEqual({ address: 'second-0' });
        expect(result.data[1000]).toEqual({ address: 'third-0' });
        expect(getHolders).toHaveBeenNthCalledWith(3, 'UNIT', {
            owner: 'wallet', page: 3, limit: 500,
        });
    });

    it('refuses a malformed later page instead of returning a partial list', async () => {
        const first = { total: 1001, data: holderRows('first', 500) };
        const getHolders = vi.fn(async (_tick, pageOpts) => {
            if (pageOpts.page === 1) return first;
            if (pageOpts.page === 2) return holderRows('second', 500);
            return { data: 'unreadable' };
        });

        await expect(holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'c',
            tick: 'UNIT',
            opts: { owner: 'wallet' },
            all: true,
        })).rejects.toThrow(/partial holders.*page 3/);
    });
});
