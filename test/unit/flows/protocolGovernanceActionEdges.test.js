// Copyright (c) 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ buildActionPsbt: vi.fn(), submitAction: vi.fn() }));
vi.mock('../../../packages/core/src/flows/buildActionPsbt.js', () => ({
    buildActionPsbt: mocks.buildActionPsbt,
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: mocks.submitAction,
}));

import {
    buildBetActionPsbt,
    buildEditFeedListsParams,
    cancelMarketAction,
    createMarketAction,
    editBetFeedListsAction,
    placeBetAction,
    resolveMarketAction,
} from '../../../packages/core/src/flows/betActions.js';
import {
    castBallotAction,
    clearVoteDelegationAction,
    delegateVoteAction,
} from '../../../packages/core/src/flows/voteActions.js';

const FROM = {
    address: 'bcrt1qgovernance',
    publicKey: `02${'ef'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/5",
};

function betHarness() {
    const betting = {
        createMarketParams: vi.fn((params) => ({ version: 0, ...params })),
        cancelMarketParams: vi.fn((params) => ({ version: 1, ...params })),
        placeBetParams: vi.fn((params) => ({ version: 2, ...params })),
        resolveMarketParams: vi.fn((params) => ({ version: 3, ...params })),
    };
    const actions = { createAction: vi.fn() };
    return { betting, actions, sdkRegistry: { get: () => ({ betting, actions }) } };
}

function betOpts(sdkRegistry, params, extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        chainRegistry: {},
        sdkRegistry,
        chainId: 'bitcoin-regtest',
        from: FROM,
        params,
        ...extra,
    };
}

beforeEach(() => {
    mocks.buildActionPsbt.mockReset();
    mocks.buildActionPsbt.mockResolvedValue({ psbtHex: '70736274ff' });
    mocks.submitAction.mockReset();
    mocks.submitAction.mockResolvedValue({ txid: 'governance-tx' });
});

describe('unsigned BET builder edges', () => {
    it.each([
        [undefined, 'buildBetActionPsbt: opts is required'],
        [{ chainId: 'c' }, 'buildBetActionPsbt: sdkRegistry is required'],
        [{ sdkRegistry: {} }, 'buildBetActionPsbt: chainId is required'],
        [{ sdkRegistry: { get: () => ({}) }, chainId: 'c', builder: 'unknown' }, 'unknown builder "unknown"'],
    ])('rejects invalid plumbing %#', (input, message) => {
        expect(() => buildBetActionPsbt(input)).toThrow(message);
        expect(mocks.buildActionPsbt).not.toHaveBeenCalled();
    });

    it('rejects a supported builder that the SDK does not provide', () => {
        expect(() => buildBetActionPsbt({
            sdkRegistry: { get: () => ({ betting: {} }) },
            chainId: 'c',
            builder: 'placeBetParams',
            params: {},
        })).toThrow('sdk.betting.placeBetParams is unavailable');
    });

    it('forwards zero and false encoder boundaries to the unsigned build', async () => {
        const h = betHarness();
        await buildBetActionPsbt({
            chainRegistry: {},
            sdkRegistry: h.sdkRegistry,
            chainId: 'c',
            from: FROM,
            builder: 'placeBetParams',
            params: { feedActionIndex: 0, amount: '1', outcome: 0 },
            fee: 0,
            feePerKb: 0,
            rbf: false,
            payFeeInNativeCoin: false,
        });
        expect(mocks.buildActionPsbt).toHaveBeenCalledWith(expect.objectContaining({
            encoderOpts: { fee: 0, feePerKb: 0, rbf: false, payFeeInNativeCoin: false },
        }));
    });
});

describe('BET list edit edges', () => {
    it.each([
        [{ actions: { createAction: vi.fn() } }, {}, 'params.feedActionIndex is required'],
        [{}, { feedActionIndex: 1, allowList: 0 }, 'sdk.actions.createAction is unavailable'],
        [{ actions: {} }, { feedActionIndex: 1, allowList: 0 }, 'sdk.actions.createAction is unavailable'],
        [{ actions: { createAction: vi.fn() } }, { feedActionIndex: 1, allowList: ' ', blockList: null }, 'enter an allow-list or block-list change'],
    ])('rejects an invalid edit %#', (sdk, input, message) => {
        expect(() => buildEditFeedListsParams(sdk, input)).toThrow(message);
    });

    it('trims list values and includes only a non-empty memo', () => {
        const createAction = vi.fn();
        const sdk = { actions: { createAction } };
        expect(buildEditFeedListsParams(sdk, {
            feedActionIndex: 4,
            allowList: ' 7 ',
            blockList: 0,
            memo: 9,
        })).toEqual({
            version: 4,
            feedActionIndex: '4',
            allowList: '7',
            blockList: '0',
            memo: '9',
        });
        expect(createAction).toHaveBeenCalledTimes(1);
    });

    it.each([
        [undefined, 'betActions: opts is required'],
        [{}, 'betActions: sdkRegistry is required'],
        [{ sdkRegistry: {} }, 'betActions: chainId is required'],
    ])('rejects edit submission plumbing %#', async (input, message) => {
        await expect(editBetFeedListsAction(input)).rejects.toThrow(message);
        expect(mocks.submitAction).not.toHaveBeenCalled();
    });

    it('tracks an edit summary and uses an imported address id', async () => {
        const h = betHarness();
        await editBetFeedListsAction(betOpts(h.sdkRegistry, {
            feedActionIndex: 4, allowList: 0,
        }, {
            from: { address: FROM.address, publicKey: FROM.publicKey, id: 'address-4' },
        }));
        const call = mocks.submitAction.mock.calls[0][0];
        expect(call.pendingTxMeta.actionSummary).toBe('Edit lists for market 4');
        expect(call.signingPaths).toEqual([{ inputIndex: 0, addressId: 'address-4' }]);
    });
});

describe('BET signed summary edges', () => {
    it.each([
        [createMarketAction, { label: 'Market', tick: 'UNIT' }, 'Open UNIT betting market "Market"'],
        [placeBetAction, { feedActionIndex: 0 }, 'Bet on market 0'],
        [resolveMarketAction, { feedActionIndex: 0 }, 'Resolve market 0'],
        [cancelMarketAction, { feedActionIndex: 0 }, 'Cancel market 0'],
    ])('submits the exact builder output with summary %s', async (action, params, actionSummary) => {
        const h = betHarness();
        await action(betOpts(h.sdkRegistry, params));
        const call = mocks.submitAction.mock.calls[0][0];
        expect(call.actionData.action).toBe('BET');
        expect(call.actionData.params).toMatchObject(params);
        expect(call.pendingTxMeta.actionSummary).toBe(actionSummary);
        expect(call.signingPaths).toEqual([{ inputIndex: 0, path: FROM.derivationPath }]);
    });
});

describe('VOTE helper availability edges', () => {
    it.each([
        [castBallotAction, { pollRef: 0 }, 'castBallotParams'],
        [delegateVoteAction, { tick: 'UNIT', delegateTo: 'bcrt1qdelegate' }, 'delegateParams'],
        [clearVoteDelegationAction, { tick: 'UNIT' }, 'clearDelegationParams'],
    ])('names an unavailable %s helper', async (action, params, builderName) => {
        const sdkRegistry = { get: () => ({ voting: {} }) };
        await expect(action({ sdkRegistry, chainId: 'c', params }))
            .rejects.toThrow(`sdk.voting.${builderName} is unavailable`);
        expect(mocks.submitAction).not.toHaveBeenCalled();
    });
});
