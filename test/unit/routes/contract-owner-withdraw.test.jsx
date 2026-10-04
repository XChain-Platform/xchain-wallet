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
    const row = { action_index: '49', status: 'valid', meta_name: 'Pool', meta_version: '1.0.0' };
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

afterEach(() => cleanup());

describe('ContractDetail owner withdraw', () => {
    const handlers = { onExecute() {}, onDeposit() {}, onWithdraw() {} };

    it('hides Withdraw behind a one-line reason when the contract refuses owner withdrawals', async () => {
        const utils = await mount(ContractDetail, messagingFor(false), handlers);
        expect(buttonNamed(utils, 'Withdraw')).toBeNull();
        expect(buttonNamed(utils, 'Deposit')).not.toBeNull();
        expect(utils.container.textContent).toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(utils.container.textContent).toContain('Owner withdraw: Not allowed');
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_WARNING);
    });

    it('offers Withdraw and warns that the deployer can pull the tokens when it is allowed', async () => {
        const utils = await mount(ContractDetail, messagingFor(true), handlers);
        expect(buttonNamed(utils, 'Withdraw')).not.toBeNull();
        expect(utils.container.textContent).toContain(OWNER_WITHDRAW_WARNING);
        expect(utils.container.textContent).toContain('Owner withdraw: Allowed');
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
    });

    it('keeps today\'s page, with no warning, when the explorer serves no answer', async () => {
        const utils = await mount(ContractDetail, messagingFor(undefined), handlers);
        expect(buttonNamed(utils, 'Withdraw')).not.toBeNull();
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_WARNING);
        expect(utils.container.textContent).not.toContain(OWNER_WITHDRAW_DISABLED_REASON);
        expect(utils.container.textContent).not.toContain('Owner withdraw:');
    });

    it('reads only a real boolean, so a stringified answer is treated as absent', async () => {
        const utils = await mount(ContractDetail, messagingFor('false'), handlers);
        expect(buttonNamed(utils, 'Withdraw')).not.toBeNull();
        expect(utils.container.textContent).not.toContain('Owner withdraw:');
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
        expect(utils.getByTestId('owner-withdraw-warning')).toHaveTextContent(OWNER_WITHDRAW_WARNING);
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
        expect(utils.getByTestId('owner-withdraw-warning')).toHaveTextContent(OWNER_WITHDRAW_WARNING);
    });

    it('shows no warning when owner withdraw is refused or unknown', async () => {
        const refused = await mount(ExecuteContractForm, messagingFor(false), {});
        expect(refused.queryByTestId('owner-withdraw-warning')).toBeNull();
        cleanup();
        const unknown = await mount(ExecuteContractForm, messagingFor(undefined), {});
        expect(unknown.queryByTestId('owner-withdraw-warning')).toBeNull();
    });
});
