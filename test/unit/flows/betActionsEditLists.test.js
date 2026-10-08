// Copyright © 2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

const { submitCalls } = vi.hoisted(() => ({ submitCalls: [] }));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: async (opts) => {
        submitCalls.push(opts);
        return { txid: 'feed-list-edit' };
    },
}));

import {
    buildEditFeedListsParams,
    editBetFeedListsAction,
} from '../../../packages/core/src/flows/betActions.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qownerexampleexampleexampleexamplexx';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: OWNER,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});

function sdkHarness() {
    const createAction = vi.fn(() => ({ actionString: 'BET|4|42||0' }));
    return { sdk: { actions: { createAction } }, createAction };
}

describe('BET v4 feed-list action flow', () => {
    it('pins v4, preserves retain/detach, and validates with the SDK composer', async () => {
        submitCalls.length = 0;
        const { sdk, createAction } = sdkHarness();
        await editBetFeedListsAction({
            sdkRegistry: { get: () => sdk },
            chainRegistry: {},
            chainId: CHAIN,
            from: ADDRESS,
            signer: {},
            trackPendingTx: false,
            params: { feedActionIndex: 42, allowList: '', blockList: 0 },
        });

        const params = {
            version: 4,
            feedActionIndex: '42',
            allowList: '',
            blockList: '0',
        };
        expect(createAction).toHaveBeenCalledWith({ action: 'BET', params });
        expect(submitCalls).toHaveLength(1);
        expect(submitCalls[0].actionData).toEqual({ action: 'BET', params });
        expect(submitCalls[0].pendingTxMeta).toBeUndefined();
    });

    it('refuses an empty edit before signing and lets the SDK reject bad replacements', () => {
        const { sdk, createAction } = sdkHarness();
        expect(() => buildEditFeedListsParams(sdk, { feedActionIndex: 42 }))
            .toThrow(/allow-list or block-list change/);
        expect(createAction).not.toHaveBeenCalled();

        createAction.mockImplementationOnce(() => { throw new Error('BLOCK_LIST must differ from ALLOW_LIST'); });
        expect(() => buildEditFeedListsParams(sdk, {
            feedActionIndex: 42, allowList: 7, blockList: 7,
        })).toThrow(/must differ/);
    });
});

describe('BET v4 signing description', () => {
    it('explains list semantics and stateful restrictions', () => {
        const decoded = decodeAction({
            action: 'BET',
            params: {
                version: 4,
                feedActionIndex: 42,
                allowList: '',
                blockList: 0,
            },
        });
        expect(decoded.summary).toBe('Edit membership lists for market 42');
        expect(decoded.details.find((row) => row.label === 'Allow list')?.value).toBe('Retain current');
        expect(decoded.details.find((row) => row.label === 'Block list')?.value).toBe('Detach');
        expect(decoded.warnings.join(' ')).toMatch(/market creator.*market is open/);
        expect(decoded.warnings.join(' ')).toContain('future bets only');
    });
});

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function routeHarness(feeds, settings = { walletMode: 'full' }) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getSettings: () => Promise.resolve(settings),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betFeeds: () => Promise.resolve({ data: feeds }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        composeBetForConfirm: (args) => {
            calls.push({ method: 'composeBetForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00',
                encoding: 'psbt',
                actionString: `BET|4|${args.params.feedActionIndex}|${args.params.allowList}|${args.params.blockList}`,
                version: 4,
                betParams: { version: 4, ...args.params },
            });
        },
        sendMessage: (method, args) => {
            calls.push({ method, args });
            return Promise.resolve({ txid: 'edit' });
        },
    };
    const messaging = new Proxy(target, {
        get(obj, prop) {
            if (prop in obj) return obj[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({});
            };
        },
    });
    return { messaging, calls };
}

function mountConsole(messaging) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(OracleConsole, { walletId: 'wallet-1', onBack() {} }),
    ));
}

function buttonsNamed(utils, name) {
    return Array.from(utils.container.querySelectorAll('button'))
        .filter((button) => (button.textContent || '').trim() === name);
}

describe('OracleConsole owner-only open-feed editor', () => {
    const openOwned = {
        action_index: '42', source: OWNER, label: 'Open owned', outcomes: 'Yes,No',
        deadline: 2000000000, expire_at: 2000003600, feed_status: 'open',
        allow_list: '12', block_list: null,
    };
    const closedOwned = {
        ...openOwned, action_index: '43', label: 'Closed owned', feed_status: 'closed',
    };
    const openForeign = {
        ...openOwned, action_index: '44', label: 'Open foreign', source: 'bc1qsomeoneelse',
    };

    it('offers one editor only for the open feed owned by the signing address', async () => {
        const { messaging, calls } = routeHarness([openOwned, closedOwned, openForeign]);
        let utils;
        await domAct(async () => {
            utils = mountConsole(messaging);
            await drain();
        });

        expect(buttonsNamed(utils, 'Edit lists')).toHaveLength(1);
        await domAct(async () => {
            fireEvent.click(buttonsNamed(utils, 'Edit lists')[0]);
            await drain();
        });
        expect(utils.getByLabelText('New allow-list index')).toBeTruthy();
        expect(utils.getByLabelText('New block-list index')).toBeTruthy();
        expect(utils.container.textContent).toContain('Changes affect future bets only');

        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('New allow-list index'), { target: { value: '81' } });
            fireEvent.click(buttonsNamed(utils, 'Review list edit')[0]);
            await drain();
        });
        const compose = calls.find((call) => call.method === 'composeBetForConfirm');
        expect(compose.args.builder).toBe('editFeedListsParams');
        expect(compose.args.params).toEqual({
            feedActionIndex: '42', allowList: '81', blockList: '',
        });
    });

    it('keeps the editor unavailable in watcher mode', async () => {
        const { messaging } = routeHarness([openOwned], { walletMode: 'watcher' });
        let utils;
        await domAct(async () => {
            utils = mountConsole(messaging);
            await drain();
        });
        expect(buttonsNamed(utils, 'Edit lists')).toHaveLength(0);
        expect(utils.container.textContent).toContain('cannot edit, resolve, or cancel');
    });
});

describe('BET v4 host and manifest wiring', () => {
    it('registers software, hardware, and compose routes and advertises format 4', () => {
        const host = readFileSync('packages/extension/src/background/createBackgroundHost.js', 'utf8');
        expect(host).toContain("registerHwHandler('action.editBetFeedLists.hw', editBetFeedListsAction)");
        expect(host).toContain("host.register('action.editBetFeedLists'");
        expect(host).toContain("'editFeedListsParams'");

        const manifest = JSON.parse(readFileSync('test/fixtures/action-manifest.json', 'utf8'));
        expect(manifest.actions.BET.userEncodableVersions).toContain(4);
    });
});
