// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Agent accounts list and detail against the app-wide rulings: the list is one
// flush list card with dividers (U41, U58), each screen has one green main
// action with an icon and every other button carries an icon (U63), and no
// "how it works" box stands in for field help (U57, U95).

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { CoSignerAccountDetail } from '../../../packages/core/src/shared/routes/CoSignerAccountDetail.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import listStyles from '../../../packages/core/src/shared/routes/CoSignerAccountList.module.css';

afterEach(() => cleanup());

function account(overrides = {}) {
    return {
        id: 'acct-1',
        walletId: 'wallet-1',
        name: 'Treasury agent',
        chainId: 'bitcoin-regtest',
        aggregateAddress: 'bcrt1qfundingaddress',
        enabled: true,
        policy: { allowedActions: ['SEND'] },
        allowedOutputs: [],
        window: { entries: [] },
        ...overrides,
    };
}

function mountList(list) {
    const onProvision = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={{ listCoSignerAccounts: vi.fn().mockResolvedValue(list) }}>
            <CoSignerAccountList walletId="wallet-1" onBack={() => {}} onOpen={() => {}} onProvision={onProvision} />
        </MessagingProvider>,
    );
    return { onProvision };
}

function mountDetail(acct) {
    render(
        <MessagingProvider shell="web" messaging={{ getSettings: () => Promise.resolve({}), getCoSignerAccount: () => Promise.resolve(acct) }}>
            <CoSignerAccountDetail accountId="acct-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('Agent accounts list', () => {
    it('empty: one green New agent account with an icon, no second blue button', async () => {
        const { onProvision } = mountList([]);
        expect(await screen.findByRole('heading', { name: 'No agent accounts yet' })).toBeInTheDocument();
        const buttons = screen.getAllByRole('button', { name: 'New agent account' });
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveClass(buttonStyles.success);
        expect(buttons[0].querySelector('svg')).not.toBeNull();
        fireEvent.click(buttons[0]);
        expect(onProvision).toHaveBeenCalledTimes(1);
    });

    it('filled: rows in one list card with leading icons, no how-it-works box', async () => {
        mountList([account(), account({ id: 'acct-2', name: 'Payroll agent', enabled: false })]);
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        expect(list).toHaveClass(listStyles.list);
        const items = list.querySelectorAll(':scope > li');
        expect(items).toHaveLength(2);
        for (const li of items) {
            expect(li.getAttribute('style')).toBeNull();
            expect(li.querySelector(`.${listStyles.rowIcon} svg`)).not.toBeNull();
        }
        expect(screen.queryByText('How agent accounts work')).toBeNull();
        expect(screen.getByRole('button', { name: 'New agent account' })).toHaveClass(buttonStyles.success);
    });
});

describe('Agent account detail', () => {
    it('a disabled account offers a green Enable with an icon; Edit policy carries an icon', async () => {
        mountDetail(account({ enabled: false }));
        const enable = await screen.findByRole('button', { name: 'Enable' });
        expect(enable).toHaveClass(buttonStyles.success);
        expect(enable.querySelector('svg')).not.toBeNull();
        const edit = screen.getByRole('button', { name: 'Edit policy' });
        expect(edit).not.toHaveClass(buttonStyles.success);
        expect(edit.querySelector('svg')).not.toBeNull();
    });

    it('an enabled account offers Disable with an icon and no green button', async () => {
        mountDetail(account());
        const disable = await screen.findByRole('button', { name: 'Disable' });
        expect(disable).not.toHaveClass(buttonStyles.success);
        expect(disable.querySelector('svg')).not.toBeNull();
    });

    it('the edit view names its action Update policy, tips Account name, and has no What changes box', async () => {
        mountDetail(account());
        fireEvent.click(await screen.findByRole('button', { name: 'Edit policy' }));
        const update = screen.getByRole('button', { name: 'Update policy' });
        expect(update).toHaveClass(buttonStyles.success);
        expect(update.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'About Account name' })).toBeInTheDocument();
        expect(screen.queryByText('What changes?')).toBeNull();
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel.querySelector('svg')).not.toBeNull();
    });
});
