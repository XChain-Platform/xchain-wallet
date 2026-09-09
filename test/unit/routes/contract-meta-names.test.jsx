// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Contract identity comes off the CHAIN now, not off this device.
//
// Until CONTRACT_META_REQUIRED the wallet asked for a Name on the deploy form
// and kept it in localStorage, because DEPLOY carries no NAME slot on any wire
// format. Anyone else looking at the same contract saw a number. A contract now
// exports `meta.name` / `meta.description` / `meta.version` in its own source,
// the indexer extracts them and the explorer serves them, so every viewer reads
// the same name.
//
// This drives the three screens rather than the helper, because the three ways
// this can regress are all UI ends: a deploy form that asks for a name it
// cannot keep, a list row that prints a name without the address that is the
// actual identity, and a detail page that shows a name the chain never
// recorded.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import { ContractsList } from '../../../packages/core/src/shared/routes/ContractsList.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { EntryRow } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'bitcoin-mainnet';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

const NAMED_SOURCE = "module.exports = { meta: { name: 'Escrow', description: "
    + "'Two-party escrow with an arbiter', version: '1.0.0' }, release(x) {} };";
const NAMELESS_SOURCE = 'module.exports = { release(x) {} };';

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
        // Recorded, because "was anything composed" is the whole question a
        // pre-flight refusal answers: composing is where the fee starts.
        composeForConfirm: (args) => {
            calls.push({ method: 'composeForConfirm', args });
            return Promise.resolve({
                psbt: 'aa00', encoding: 'psbt', actionString: 'ACT|0', version: 0,
            });
        },
        deployAction: (args) => {
            calls.push({ method: 'deployAction', args });
            return Promise.resolve({ txid: 'ff11ee22', indexed: null });
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

describe('the deploy form no longer asks for a name', () => {
    it('has no Name input at all', async () => {
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        const labels = Array.from(utils.container.querySelectorAll('label'))
            .map((l) => l.textContent || '');
        expect(labels.some((l) => /^Name/.test(l))).toBe(false);
        // And no input carries the old label either, under any wrapper.
        expect(utils.queryByLabelText(/^Name \(optional\)/)).toBeNull();
        expect(utils.container.textContent).not.toMatch(/saved on this device/i);
    });

    it('shows the name, version and description parsed out of the pasted source, read-only', async () => {
        const { messaging } = harness({
            getContractExportedMeta: () => Promise.resolve({
                status: 'present',
                name: 'Escrow',
                description: 'Two-party escrow with an arbiter',
                version: '1.0.0',
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: NAMED_SOURCE } });
            await drain();
        });
        const panel = utils.container.querySelector('[aria-label="Contract identity"]');
        expect(panel).not.toBeNull();
        expect(panel.textContent).toContain('Escrow');
        expect(panel.textContent).toContain('1.0.0');
        expect(panel.textContent).toContain('Two-party escrow with an arbiter');
        // Read-only: nothing in the panel is an input the user could edit.
        expect(panel.querySelectorAll('input, textarea').length).toBe(0);
    });

    it('shows NOTHING rather than a stale label when the shell cannot answer', async () => {
        // No getContractExportedMeta on the messaging target: the Proxy's
        // catch-all still answers with a resolved {}, which is exactly the
        // shape a `typeof` feature-detect would be fooled by.
        const { messaging } = harness();
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: NAMED_SOURCE } });
            await drain();
        });
        expect(utils.container.querySelector('[aria-label="Contract identity"]')).toBeNull();
        // No identity claim of any kind: not a name, not the computed-name
        // advisory, not the refusal. The wallet says nothing about a contract
        // it could not read.
        expect(utils.container.textContent).not.toMatch(/computed rather than written out/);
        expect(utils.container.textContent).not.toMatch(/exports no name or description/);
    });

    it('refuses a proven-nameless source before it composes anything', async () => {
        const { messaging, calls } = harness({
            getContractExportedMeta: () => Promise.resolve({ status: 'absent' }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: NAMELESS_SOURCE } });
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Deploy/));
            await drain(40);
        });
        // Nothing was composed: no confirm screen, no compose call, no fee.
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(false);
        expect(calls.some((c) => c.method === 'deployAction')).toBe(false);
        expect(utils.container.textContent).toContain('invalid: CONTRACT_MANIFEST (meta required)');
    });

    it('does not refuse a computed (undecidable) meta: the chain evaluates it', async () => {
        const { messaging, calls } = harness({
            getContractExportedMeta: () => Promise.resolve({ status: 'undecidable' }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(DeployContractForm, messaging, {});
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: NAMED_SOURCE } });
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(button(utils, /^Deploy/));
            await drain(40);
        });
        expect(calls.some((c) => c.method === 'composeForConfirm')).toBe(true);
    });
});

describe('the contracts list names a contract off the chain', () => {
    it('prints "Name vX (C:COIN:index)" on a row', async () => {
        const { messaging } = harness({
            getContractsForSource: () => Promise.resolve({
                data: [{
                    action_index: '12',
                    source: HD_ADDRESS.address,
                    status: 'valid',
                    meta_name: 'Escrow',
                    meta_version: '1.0.0',
                }],
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });
        expect(utils.container.textContent).toContain('Escrow v1.0.0 (C:BTC:12)');
    });

    it('reads "Unnamed contract" for a contract deployed before the flag day', async () => {
        const { messaging } = harness({
            getContractsBrowseAll: () => Promise.resolve({
                data: [{ action_index: '7', status: 'valid' }],
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });
        expect(utils.container.textContent).toContain('Unnamed contract (C:BTC:7)');
    });

    it('names an interaction row from the DEPOSIT payload that carried it', async () => {
        const { messaging } = harness({
            getDepositsForAddress: () => Promise.resolve({
                data: [{
                    contract_action_index: '99',
                    block_index: '5000',
                    contract_meta_name: 'Vesting',
                    contract_meta_version: '2.1.0',
                }],
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });
        expect(utils.container.textContent).toContain('Vesting v2.1.0 (C:BTC:99)');
    });

    it('filters rows by the chain-recorded name', async () => {
        const { messaging } = harness({
            getContractsBrowseAll: () => Promise.resolve({
                data: [
                    { action_index: '1', status: 'valid', meta_name: 'Escrow' },
                    { action_index: '2', status: 'valid', meta_name: 'Treasury' },
                ],
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractsList, messaging, { onOpenContract() {} });
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Filter contracts'), { target: { value: 'treas' } });
            await drain();
        });
        expect(utils.container.textContent).toContain('Treasury (C:BTC:2)');
        expect(utils.container.textContent).not.toContain('Escrow (C:BTC:1)');
    });
});

describe('the contract detail page reads its identity off the contract row', () => {
    it('heads with the name, version and derived address, and shows the description', async () => {
        const { messaging } = harness({
            getContractByActionIndex: () => Promise.resolve({
                data: {
                    action_index: '42',
                    source: HD_ADDRESS.address,
                    status: 'valid',
                    meta_name: 'Escrow',
                    meta_version: '1.0.0',
                    meta_description: 'Two-party escrow with an arbiter',
                },
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractDetail, messaging, { chainId: CHAIN, contractActionIndex: '42' });
            await drain();
        });
        expect(utils.container.textContent).toContain('Escrow v1.0.0 (C:BTC:42)');
        expect(utils.container.textContent).toContain('Two-party escrow with an arbiter');
        // The rename control is gone: nothing on this device can change what the
        // chain recorded.
        expect(button(utils, /Rename|Name this contract/)).toBeUndefined();
    });

    it('never renders a hostile name raw', async () => {
        const { messaging } = harness({
            getContractByActionIndex: () => Promise.resolve({
                data: { action_index: '42', status: 'valid', meta_name: 'Escrow‮gnp.exe' },
            }),
        });
        let utils;
        await domAct(async () => {
            utils = mount(ContractDetail, messaging, { chainId: CHAIN, contractActionIndex: '42' });
            await drain();
        });
        expect(utils.container.textContent).not.toContain('‮');
        expect(utils.container.textContent).toContain('C:BTC:42');
    });
});

// A history row is where most people meet a contract: they funded, called or
// withdrew from one, and until now the row said only which action it was and
// who signed it. The four contract-bearing payloads carry the contract's name
// and version beside its index, so the row can say WHICH contract.
describe('a history row names the contract it touched', () => {
    function historyEntry(action, raw) {
        return {
            key: `${CHAIN}:100:addr`,
            chainId: CHAIN,
            address: HD_ADDRESS.address,
            actionIndex: '100',
            action,
            blockIndex: 7804,
            timestamp: 1787880118,
            txHash: 'deadbeef',
            source: HD_ADDRESS.address,
            raw,
            link: null,
        };
    }

    function renderRow(entry) {
        return render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: harness().messaging },
                React.createElement('ul', null, React.createElement(EntryRow, {
                    entry, selected: false, showConnector: false, onClick() {}, isFull: true,
                })),
            ),
        );
    }

    it('reads "Escrow v1.0.0 (C:BTC:12)" on an EXECUTE row', () => {
        const utils = renderRow(historyEntry('EXECUTE', {
            contract_index: '12', contract_meta_name: 'Escrow', contract_meta_version: '1.0.0',
        }));
        expect(utils.container.textContent).toContain('Escrow v1.0.0 (C:BTC:12)');
    });

    // Under deferred assembly the contract does not necessarily sit at the
    // DEPLOY's own action, so the row reads the resolved index the payload
    // publishes rather than the action it is looking at.
    it('reads a DEPLOY row off deployed_contract_index, not the action index', () => {
        const utils = renderRow(historyEntry('DEPLOY', {
            deployed_contract_index: '3002', contract_meta_name: 'Escrow',
        }));
        expect(utils.container.textContent).toContain('Escrow (C:BTC:3002)');
        expect(utils.container.textContent).not.toContain('C:BTC:100');
    });

    it('says nothing on a row that touched no contract', () => {
        const utils = renderRow(historyEntry('SEND', { amount: '1', tick: 'BTC' }));
        expect(utils.container.textContent).not.toContain('C:BTC:');
    });

    it('says nothing on a contract action whose payload carries no index', () => {
        const utils = renderRow(historyEntry('DEPOSIT', { contract_meta_name: 'Escrow' }));
        expect(utils.container.textContent).not.toContain('Escrow');
    });
});
