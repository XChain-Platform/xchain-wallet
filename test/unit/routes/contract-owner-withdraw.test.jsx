// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// OWNER_WITHDRAW_OPT_IN: a contract deployed after the activation refuses
// owner WITHDRAW unless its meta declares `ownerWithdraw: true`, and the
// explorer serves the answer as `owner_withdraw` on the contract row. These
// drive the real screens with each of the three answers: false must stop the
// wallet offering a WITHDRAW that consensus refuses after the fee is paid, true
// must warn anyone viewing or funding the contract that the deployer can pull
// its tokens, and an absent field (an older explorer) must leave every screen
// exactly as it was, with no warning invented.

import { describe, it, expect, afterEach } from 'vitest';
import { render, act as domAct, cleanup } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContractDetail } from '../../../packages/core/src/shared/routes/ContractDetail.jsx';
import { ContractFundsForm } from '../../../packages/core/src/shared/routes/ContractFundsForm.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import {
    OWNER_WITHDRAW_DISABLED_REASON,
    OWNER_WITHDRAW_WARNING,
} from '../../../packages/core/src/shared/routes/contractResponseShape.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

// A contract row carrying the explorer's answer, or no field at all when the
// answer is undefined (what an explorer without the derivation serves).
function contractRow(ownerWithdraw) {
    const row = { action_index: '49', status: 'valid', meta_name: 'Pool', meta_version: '9.8.7' };
    if (ownerWithdraw !== undefined) row.owner_withdraw = ownerWithdraw;
    return { data: row };
}

function messagingFor(ownerWithdraw, overrides = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getContractByActionIndex: () => Promise.resolve(contractRow(ownerWithdraw)),
        getActionByIndex: () => Promise.resolve({}),
        getContractState: () => Promise.resolve({}),
        getContractBalance: () => Promise.resolve({ data: [{ tick: 'XCHAIN', quantity: '500' }] }),
        getExecutionsForContract: () => Promise.resolve({ data: [] }),
        ...overrides,
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mount(Component, messaging, props) {
    let utils;
    await domAct(async () => {
        utils = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Component, {
                    walletId: 'w', chainId: CHAIN, contractActionIndex: '49', onBack() {}, ...props,
                }),
            ),
        );
        await drain();
    });
    return utils;
}

function buttonNamed(utils, name) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => (b.textContent || '').trim() === name) || null;
}

// The contract page's actions are action-list rows (G101): a row's text is
// its title plus a description, so it is found by the title it starts with.
function actionRowNamed(utils, name) {
    const list = utils.container.querySelector('ul[aria-label="Contract actions"]');
    return Array.from(list?.querySelectorAll('button') || [])
        .find((b) => (b.textContent || '').trim().startsWith(name)) || null;
}

// The facts card is on the Details tab: "Label: value" per row.
async function factsText(utils) {
    const tab = Array.from(utils.container.querySelectorAll('[role="tab"]'))
        .find((t) => (t.textContent || '').trim() === 'Details');
    await domAct(async () => {
        tab.click();
        await drain();
    });
    const dl = utils.container.querySelector('dl[aria-label="Contract details"]');
    return Array.from(dl.children)
        .map((row) => `${row.querySelector('dt').textContent}: ${row.querySelector('dd').textContent}`)
        .join('\n');
}

afterEach(() => cleanup());

describe('ContractDetail owner withdraw', () => {
    const handlers = { onExecute() {}, onDeposit() {}, onWithdraw() {} };

    it('dims the Withdraw row with its one-line reason when the contract refuses owner withdrawals', async () => {
        const utils = await mount(ContractDetail, messagingFor(false), handlers);
        const withdraw = actionRowNamed(utils, 'Withdraw');
        expect(withdraw).not.toBeNull();
        expect(withdraw.getAttribute('aria-disabled')).toBe('true');
        expect(withdraw.textContent).toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(actionRowNamed(utils, 'Deposit').getAttribute('aria-disabled')).toBeNull();
        expect(utils.container.textContent).toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_WARNING);
        expect(await factsText(utils)).toContain('Owner withdraw: Not allowed');
    });

    it('offers Withdraw and warns that the deployer can pull the tokens when it is allowed', async () => {
        const utils = await mount(ContractDetail, messagingFor(true), handlers);
        expect(actionRowNamed(utils, 'Withdraw').getAttribute('aria-disabled')).toBeNull();
        expect(utils.container.textContent).toContain(OWNER_WITHDRAW_WARNING);
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(await factsText(utils)).toContain('Owner withdraw: Allowed');
    });

    it('keeps today\'s page, with no warning, when the explorer serves no answer', async () => {
        const utils = await mount(ContractDetail, messagingFor(undefined), handlers);
        expect(actionRowNamed(utils, 'Withdraw').getAttribute('aria-disabled')).toBeNull();
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_WARNING);
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(await factsText(utils)).not.toContain('Owner withdraw:');
    });

    it('reads only a real boolean, so a stringified answer is treated as absent', async () => {
        const utils = await mount(ContractDetail, messagingFor('false'), handlers);
        expect(actionRowNamed(utils, 'Withdraw').getAttribute('aria-disabled')).toBeNull();
        expect(await factsText(utils)).not.toContain('Owner withdraw:');
    });
});

describe('ContractFundsForm owner withdraw', () => {
    it('stops a WITHDRAW the contract refuses at the form, with the submit disabled', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(false), { mode: 'withdraw' });
        expect(utils.getByRole('alert')).toHaveTextContent(OWNER_WITHDRAW_DISABLED_REASON);
        const submit = buttonNamed(utils, 'Withdraw');
        expect(submit).not.toBeNull();
        expect(submit.disabled).toBe(true);
    });

    it('leaves the WITHDRAW form as it was when the explorer serves no answer', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(undefined), { mode: 'withdraw' });
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(utils.queryByRole('alert')).toBeNull();
    });

    it('leaves the WITHDRAW form as it was on a shell without the contract lookup', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(false, { getContractByActionIndex: undefined }), { mode: 'withdraw' });
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
    });

    it('warns on a DEPOSIT into a contract whose deployer can withdraw', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(true), { mode: 'deposit' });
        const warning = utils.getByTestId('owner-withdraw-warning');
        const confirm = buttonNamed(utils, 'Deposit');
        expect(warning).toHaveTextContent(OWNER_WITHDRAW_WARNING);
        expect(confirm).not.toBeNull();
        expect(warning.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('puts the DEPOSIT warning first in the form, in the warning notice style', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(true), { mode: 'deposit' });
        const warning = utils.getByTestId('owner-withdraw-warning');
        const before = Array.from(utils.container.querySelectorAll('input, select, textarea, [data-form-sections]'))
            .filter((el) => warning.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
        expect(before).toEqual([]);
        const sections = utils.container.querySelector('[data-form-sections]');
        expect(warning.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(warning).toHaveTextContent('Deployer can withdraw');
    });

    it('does not warn on a DEPOSIT into a contract that refuses owner withdrawals', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(false), { mode: 'deposit' });
        expect(utils.queryByTestId('owner-withdraw-warning')).toBeNull();
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
    });
});

describe('ExecuteContractForm owner withdraw', () => {
    it('warns before a call into a contract whose deployer can withdraw', async () => {
        const utils = await mount(ExecuteContractForm, messagingFor(true), {});
        const warning = utils.getByTestId('owner-withdraw-warning');
        const confirm = buttonNamed(utils, 'Call Contract');
        expect(warning).toHaveTextContent(OWNER_WITHDRAW_WARNING);
        expect(confirm).not.toBeNull();
        expect(warning.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('puts the warning first in the form, above the From section and every field', async () => {
        const utils = await mount(ExecuteContractForm, messagingFor(true), {});
        const warning = utils.getByTestId('owner-withdraw-warning');
        const sections = utils.container.querySelector('[data-form-sections]');
        expect(sections).not.toBeNull();
        const before = Array.from(utils.container.querySelectorAll('input, select, textarea, [data-form-sections]'))
            .filter((el) => warning.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
        expect(before).toEqual([]);
        expect(warning.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(sections.contains(warning)).toBe(false);
    });

    it('draws Remove Deposit with the danger variant', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/ExecuteContractForm.jsx'),
            'utf8',
        );
        expect(source).toMatch(/<Button\s+type="button"\s+variant="danger"\s+icon=\{<Icon\.TrashIcon \/>\}\s+onClick=\{\(\) => \{ setDepositTick\(''\);[^}]*\}\}\s*>\s*\{t\('execute\.removeDeposit'\)\}/);
    });

    it('shows no warning when owner withdraw is refused or unknown', async () => {
        const refused = await mount(ExecuteContractForm, messagingFor(false), {});
        expect(refused.queryByTestId('owner-withdraw-warning')).toBeNull();
        cleanup();
        const unknown = await mount(ExecuteContractForm, messagingFor(undefined), {});
        expect(unknown.queryByTestId('owner-withdraw-warning')).toBeNull();
    });
});

describe('Contract forms keep a fixed title and show the contract as the first field', () => {
    it.each([
        ['Execute Contract', ExecuteContractForm, {}, 'call'],
        ['Deposit to Contract', ContractFundsForm, { mode: 'deposit' }, 'main'],
        ['Withdraw from Contract', ContractFundsForm, { mode: 'withdraw' }, 'main'],
    ])('%s', async (title, Component, props, sectionId) => {
        const utils = await mount(Component, messagingFor(true), props);
        expect(utils.getByRole('heading', { name: title })).toBeInTheDocument();
        expect(utils.queryByRole('heading', { name: /#49|Pool/ })).toBeNull();

        const contract = utils.getByRole('group', { name: 'Contract' });
        expect(contract).toHaveTextContent('Pool#49');
        expect(contract.querySelector('button')).toHaveAccessibleName('Choose another contract');
        // The first field of the main section.
        const section = utils.container.querySelector(`[data-form-section="${sectionId}"]`);
        const firstField = section.querySelector('[id^="form-section-"] > *');
        expect(firstField).toBe(contract.closest('[data-target-field]'));
        // The deployer-can-withdraw warning still leads the form.
        if (props.mode !== 'withdraw') {
            const warning = utils.getByTestId('owner-withdraw-warning');
            expect(warning.compareDocumentPosition(contract) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('opens the contracts list from the list icon instead of the form', async () => {
        const utils = await mount(ContractFundsForm, messagingFor(true, {
            getContracts: () => Promise.resolve({ data: [] }),
        }), { mode: 'deposit' });
        await domAct(async () => {
            utils.getByRole('button', { name: 'Choose another contract' }).click();
            await drain();
        });
        expect(utils.queryByRole('group', { name: 'Contract' })).toBeNull();
        expect(utils.queryByRole('heading', { name: 'Deposit to Contract' })).toBeNull();
    });
});
