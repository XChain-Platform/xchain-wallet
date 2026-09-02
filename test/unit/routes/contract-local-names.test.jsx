// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The deploy form's Name field and the contract list have to agree
// about what a name does.
//
// They did not. The field labelled the review screen and was then dropped on
// the floor - the protocol has no NAME slot on DEPLOY, so nothing carried it -
// and every contract in the list read "(unnamed)" however carefully the user
// had named it. The operator's ruling was to keep the field and make it true:
// a device-local label, keyed by chain + the contract's action index, written
// on deploy success and merged into both contract surfaces plus a rename.
//
// This drives the round trip through the actual screens rather than the store
// alone, because the two ends that broke are UI ends: the write at deploy
// success (where the action index is not knowable yet, only the txid) and the
// read in the list row.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import {
    contractNameFor,
    readContractNames,
    setContractName,
} from '../../../packages/core/src/shared/utils/contractNameMemory.js';

const CHAIN = 'bitcoin-mainnet';
const DEPLOY_TXID = 'ff11ee22dd33cc44';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const CONTRACT_SOURCE = 'function main() { return 1; }';

function harness(overrides = {}) {
    const calls = [];
    const record = (method) => (args) => {
        calls.push({ method, args });
        return Promise.resolve({});
    };
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [], unverified: [] }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        composeForConfirm: () => Promise.resolve({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT|0', version: 0,
        }),
        // The single-leg deploy lane: broadcast, and no indexer wait, so the
        // result knows a txid and nothing about an action index.
        deployAction: (args) => {
            calls.push({ method: 'deployAction', args });
            return Promise.resolve({ txid: DEPLOY_TXID, indexed: null });
        },
        getContractsForSource: () => Promise.resolve({ data: [] }),
        getDepositsForAddress: () => Promise.resolve({ data: [] }),
        getWithdrawalsForAddress: () => Promise.resolve({ data: [] }),
        getContractsBrowseAll: () => Promise.resolve({ data: [] }),
        getContractByActionIndex: () => Promise.resolve({}),
        getActionByIndex: () => Promise.resolve({}),
        getContractState: () => Promise.resolve({}),
        getContractBalance: () => Promise.resolve({}),
        getExecutionsForContract: () => Promise.resolve({ data: [] }),
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return record(String(prop));
        },
    });
    return { messaging, calls };
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function mount(Component, messaging, props) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Component, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

function button(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe('the deploy form persists the Name it asked for', () => {
    it('files the typed name against the deployed contract on success', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText(/^Name/), { target: { value: '  MyMarket  ' } });
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: CONTRACT_SOURCE } });
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Deploy/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Password'), { target: { value: 'hunter2' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });

        // Trimmed, and filed under the only identity this lane knows.
        expect(contractNameFor({ chainId: CHAIN, txid: DEPLOY_TXID })).toBe('MyMarket');
        // The done screen says where the name went, so "it kept my name" is
        // observable at the moment the user is looking for it.
        expect(utils.container.textContent).toContain('MyMarket');
        expect(utils.container.textContent).toMatch(/saved on this device/i);
    });

    it('stores nothing when the user leaves the name blank', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: CONTRACT_SOURCE } });
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Deploy/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Password'), { target: { value: 'hunter2' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drain();
        });
        expect(readContractNames(CHAIN)).toEqual({ byIndex: {}, byTxid: {} });
    });
});

describe('the contracts list shows the stored name', () => {
    it('renders the label instead of (unnamed), and settles a txid-filed one onto its index', async () => {
        // Exactly the state the deploy above leaves behind: a label waiting on
        // a txid because the action index did not exist yet.
        const { messaging } = harness({
            getContractsForSource: () => Promise.resolve({
                data: [{ action_index: 4711, tx_hash: DEPLOY_TXID, status: 'valid', block_index: 12 }],
            }),
        });
        localStorage.setItem(`xc:contractNames:${CHAIN}`, JSON.stringify({
            byIndex: {},
            byTxid: { [DEPLOY_TXID]: { name: 'MyMarket', ts: 1 } },
        }));

        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });

        expect(utils.container.textContent).toContain('MyMarket #4711');
        expect(utils.container.textContent).not.toContain('(unnamed) #4711');
        // The label has moved to the stable identity, so it survives the txid
        // bucket being pruned and shows on every later load.
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '4711' })).toBe('MyMarket');
        expect(readContractNames(CHAIN).byTxid[DEPLOY_TXID]).toBeUndefined();
    });

    it('still says (unnamed) for a contract nobody on this device named', async () => {
        const { messaging } = harness({
            getContractsForSource: () => Promise.resolve({
                data: [{ action_index: 4712, status: 'valid', block_index: 12 }],
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });
        expect(utils.container.textContent).toContain('(unnamed) #4712');
    });
});

describe('the contract detail page names and renames', () => {
    async function mountDetail(messaging) {
        let utils;
        await domAct(async () => {
            utils = mount(ContractDetail, messaging, { chainId: CHAIN, contractActionIndex: '4711' });
            await drain();
        });
        return utils;
    }

    const loaded = {
        getContractByActionIndex: () => Promise.resolve({
            data: { action_index: 4711, tx_hash: DEPLOY_TXID, source: 'bc1qowner', status: 'valid', block_index: 12 },
        }),
    };

    it('shows the stored label in the heading', async () => {
        setContractName({ chainId: CHAIN, actionIndex: '4711', name: 'MyMarket' });
        const { messaging } = harness(loaded);
        const utils = await mountDetail(messaging);
        expect(utils.container.textContent).toContain('Contract #4711: "MyMarket"');
    });

    it('picks up a label still filed under the deploy txid', async () => {
        localStorage.setItem(`xc:contractNames:${CHAIN}`, JSON.stringify({
            byIndex: {},
            byTxid: { [DEPLOY_TXID]: { name: 'Escrow', ts: 1 } },
        }));
        const { messaging } = harness(loaded);
        const utils = await mountDetail(messaging);
        expect(utils.container.textContent).toContain('Contract #4711: "Escrow"');
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '4711' })).toBe('Escrow');
    });

    it('renames a contract, and the new label is what the list would read', async () => {
        setContractName({ chainId: CHAIN, actionIndex: '4711', name: 'MyMarket' });
        const { messaging } = harness(loaded);
        const utils = await mountDetail(messaging);

        await domAct(async () => {
            fireEvent.click(button(utils, /^Rename$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Name'), { target: { value: 'Prediction market' } });
            fireEvent.click(button(utils, /^Save name$/));
            await drain();
        });

        expect(utils.container.textContent).toContain('Contract #4711: "Prediction market"');
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '4711' })).toBe('Prediction market');
    });

    it('names a contract that had no label, and can remove it again', async () => {
        const { messaging } = harness(loaded);
        const utils = await mountDetail(messaging);
        expect(utils.container.textContent).toContain('Contract #4711: "(unnamed)"');

        await domAct(async () => {
            fireEvent.click(button(utils, /^Name this contract$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Name'), { target: { value: 'Escrow' } });
            fireEvent.click(button(utils, /^Save name$/));
            await drain();
        });
        expect(utils.container.textContent).toContain('Contract #4711: "Escrow"');

        await domAct(async () => {
            fireEvent.click(button(utils, /^Rename$/));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Remove name$/));
            await drain();
        });
        expect(utils.container.textContent).toContain('Contract #4711: "(unnamed)"');
        expect(contractNameFor({ chainId: CHAIN, actionIndex: '4711' })).toBeNull();
    });
});
