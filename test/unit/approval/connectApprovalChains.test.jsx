// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The connect prompt's chain checklist, mounted for real (§9.7 / §43.3).
//
// The approval window is its own MV3 realm with its own defaultRegistry(),
// so a chain the operator added in Developer Mode reaches it only through
// the settings record. The window boots against a locked vault, the boot
// read races the window's own request fetch, and a connect prompt carries
// no password gate, so the surface has to install the persisted chains
// itself and re-render when they land: a list and a pre-selection derived
// once in the component body offer bundled chains only for the life of the
// window, and a dApp that asked for the operator's chain gets a prompt that
// cannot grant it.
//
// The sibling smoke reads this file's TEXT. These cases render it.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { defaultRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { EXAMPLE_CONNECT_OPTS } from '../../../packages/test-dapp/src/example.ts';

const shim = vi.hoisted(() => ({
    getSettings: async () => ({}),
    resolveApproval: async () => ({ approved: true }),
}));
vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: (...args) => shim.getSettings(...args),
    resolveApproval: (...args) => shim.resolveApproval(...args),
}));

const { ConnectApproval, connectCoinFamilies } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const bundled = BUNDLED_DESCRIPTORS[0];
const label = (d) => `Allow ${d.displayName}`;
const custom = (id, displayName) => ({ ...template, id, displayName });

function mount(requestedChains) {
    return render(
        <ConnectApproval
            id="req-1"
            payload={{ origin: 'https://dapp.test', appName: 'Test dApp', requestedChains }}
            onReject={() => {}}
        />,
    );
}

afterEach(() => {
    cleanup();
    shim.getSettings = async () => ({});
    shim.resolveApproval = async () => ({ approved: true });
    vi.restoreAllMocks();
});

describe('ConnectApproval network checklist', () => {
    it('groups every network of an added coin into one future family', () => {
        const future = [
            { ...bundled, id: 'future-testnet', coin: 'future', displayName: 'Future', networkKind: 'testnet' },
            { ...bundled, id: 'future-mainnet', coin: 'future', displayName: 'Future', networkKind: 'mainnet' },
        ];

        const family = connectCoinFamilies([...BUNDLED_DESCRIPTORS, ...future])
            .find((entry) => entry.coin === 'future');
        expect(family.name).toBe('Future');
        expect(family.chainIds).toEqual(['future-testnet', 'future-mainnet']);
        expect(family.descriptor.id).toBe('future-mainnet');
    });

    it('shows the large site identity with a safe name and full origin', () => {
        const longOrigin = 'https://wallet.example.com.login.account.security.attacker.test';
        const { container } = render(
            <ConnectApproval
                id="identity"
                payload={{
                    origin: longOrigin,
                    appName: 'XChain Wallet\u202Esecurity',
                    requestedChains: [bundled.id],
                }}
                onReject={() => {}}
            />,
        );

        expect(screen.getByRole('region', { name: 'Requesting site' })).toBeVisible();
        expect(screen.getByTestId('site-icon')).toBeVisible();
        expect(screen.getByTestId('request-origin-full').textContent).toBe(longOrigin);
        expect(screen.getByText('XChain Wallet␦security')).toBeTruthy();
        expect(screen.queryByText('XChain Wallet\u202Esecurity')).toBeNull();
        expect(container.querySelector('[data-xc-avatar-context="hero"]')).toBeTruthy();
        expect(screen.queryByText(/This site wants to see accounts and networks/)).toBeNull();
    });

    it('blocks an origin containing hidden control characters', () => {
        render(
            <ConnectApproval
                id="identity-origin"
                payload={{
                    origin: 'https://safe.test\u202E.example',
                    requestedChains: [bundled.id],
                }}
                onReject={() => {}}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent(
            'This connection request is missing or invalid.',
        );
    });

    it('renders a dApp name containing markup as text in the approval', () => {
        const origin = 'https://markup.test';
        const appName = '<script>globalThis.appNameExecuted = true</script>';
        const { container } = render(
            <ConnectApproval
                id="markup-identity"
                payload={{ origin, appName, requestedChains: [bundled.id] }}
                onReject={() => {}}
            />,
        );

        expect(screen.getByTestId('request-origin-full')).toHaveTextContent('https://markup.test');
        expect(screen.getByText(appName)).toBeInTheDocument();
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img[src="x"]')).toBeNull();
        expect(globalThis.originExecuted).toBeUndefined();
        expect(globalThis.appNameExecuted).toBeUndefined();
    });

    it('puts the two permission lines under Accounts and shows one row per coin family', () => {
        mount([bundled.id]);

        const permissions = document.querySelector('[data-connect-permissions]');
        expect(permissions.textContent).toContain('addresses and balances');
        expect(permissions.textContent).toContain('Ask you each time it wants a signature');
        expect([...permissions.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
            'See the addresses and balances of the accounts you share',
            'Ask you each time it wants a signature',
        ]);
        expect(screen.getByText('Accounts it can see').closest('[data-picker-field]').nextElementSibling)
            .toBe(permissions);
        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        const familyRows = screen.getAllByRole('switch');
        expect(familyRows).toHaveLength(new Set(defaultRegistry().supportedChains().map((d) => d.coin)).size);
        expect(familyRows.map((row) => row.getAttribute('aria-label'))).toEqual([
            'Allow Bitcoin',
            'Allow Litecoin',
            'Allow Dogecoin',
        ]);
        expect(screen.getByLabelText(label(bundled))).toBeTruthy();
        expect(screen.queryByRole('checkbox', { name: /message signatures/i })).toBeNull();
    });

    it('preselects the family requested by the worked example', () => {
        mount(EXAMPLE_CONNECT_OPTS.requestedChains);

        const exampleChain = BUNDLED_DESCRIPTORS.find(
            (descriptor) => descriptor.id === EXAMPLE_CONNECT_OPTS.requestedChains[0],
        );
        expect(exampleChain).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        expect(screen.getByLabelText(label(exampleChain)).checked).toBe(true);
    });

    it('preselects requested families and counts them once in the field', () => {
        const bitcoinTestnet = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-testnet');
        const litecoinRegtest = BUNDLED_DESCRIPTORS.find((d) => d.id === 'litecoin-regtest');
        const { container } = mount([bitcoinTestnet.id, litecoinRegtest.id]);

        expect(container.querySelectorAll('[data-picker-field="connect-networks"] [data-picker-icon]'))
            .toHaveLength(2);
        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        expect(screen.getByLabelText('Allow Bitcoin')).toBeChecked();
        expect(screen.getByLabelText('Allow Litecoin')).toBeChecked();
        expect(screen.getByLabelText('Allow Dogecoin')).not.toBeChecked();
    });

    it('submits every network id in a family when its coin is turned on', async () => {
        const submitted = [];
        shim.resolveApproval = async (_id, decision) => { submitted.push(decision); };
        vi.spyOn(window, 'close').mockImplementation(() => {});
        mount([]);

        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        fireEvent.click(screen.getByLabelText('Allow Bitcoin'));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });

        expect(submitted).toHaveLength(1);
        expect(submitted[0].chains).toEqual(defaultRegistry().byCoin('bitcoin').map((d) => d.id));
    });

    it('has standard help on both editable picker fields', () => {
        mount([bundled.id]);

        const networksHelp = screen.getByRole('button', { name: 'About Networks it can see' });
        const accountsHelp = screen.getByRole('button', { name: 'About Accounts it can see' });
        expect(document.getElementById(networksHelp.getAttribute('aria-describedby'))).toHaveTextContent(
            'The coins this site can see. Turning a coin on shares its addresses on every network for that coin.',
        );
        expect(document.getElementById(accountsHelp.getAttribute('aria-describedby'))).toHaveTextContent(
            'The accounts whose addresses and balances this site can see. It can never sign or spend without asking you.',
        );
    });

    it('rejects in one click while both decisions are enabled', () => {
        const onReject = vi.fn();
        render(
            <ConnectApproval
                id="reject"
                payload={{ origin: 'https://dapp.test', requestedChains: [bundled.id] }}
                onReject={onReject}
            />,
        );

        const reject = screen.getByRole('button', { name: 'Reject' });
        const connect = screen.getByRole('button', { name: 'Approve' });
        expect(reject).not.toBeDisabled();
        expect(connect).not.toBeDisabled();
        fireEvent.click(reject);
        expect(onReject).toHaveBeenCalledTimes(1);
    });

    it('offers and pre-selects a user-added network that arrives with the settings read', async () => {
        const added = custom('operator-connect', 'Operator Connect');
        shim.getSettings = async () => ({ customChains: [added] });

        mount([added.id]);

        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        const box = await screen.findByLabelText('Allow Bitcoin');
        await vi.waitFor(() => expect(box).toBeChecked());
        expect(defaultRegistry().has(added.id)).toBe(true);
    });

    it('still renders the bundled networks when the settings read fails on a locked vault', async () => {
        shim.getSettings = async () => { throw new Error('vault is locked'); };

        mount([bundled.id]);

        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        const box = await screen.findByLabelText(label(bundled));
        expect(box.checked).toBe(true);
    });

    it('leaves a network the user unchecked unchecked when hydration lands after it', async () => {
        const added = custom('operator-connect-late', 'Operator Late');
        let release = () => {};
        shim.getSettings = () => new Promise((resolve) => {
            release = () => resolve({ customChains: [added] });
        });

        mount([bundled.id, added.id]);

        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        const bundledBox = await screen.findByLabelText(label(bundled));
        expect(bundledBox.checked).toBe(true);
        fireEvent.click(bundledBox);
        expect(bundledBox.checked).toBe(false);

        await act(async () => { release(); await Promise.resolve(); });

        expect(screen.getByLabelText('Allow Bitcoin')).not.toBeChecked();
    });
});

describe('ConnectApproval account checklist', () => {
    const ACCOUNTS = [
        { id: 'acct-1', name: 'Account 1' },
        { id: 'acct-2', name: 'Account 2' },
    ];

    // A resolved approval closes its window; jsdom would tear the document
    // down for every later case, so the close is recorded instead.
    let closeSpy;
    afterEach(() => { closeSpy?.mockRestore(); closeSpy = undefined; });

    function mountWithAccounts(accountOptions) {
        closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
        return render(
            <ConnectApproval
                id="req-accounts"
                payload={{
                    origin: 'https://dapp.test',
                    appName: 'Test dApp',
                    requestedChains: [bundled.id],
                    accountOptions,
                }}
                onReject={() => {}}
            />,
        );
    }

    it('ticks only the primary account and submits what the user ticks', async () => {
        const submitted = [];
        shim.resolveApproval = async (_id, decision) => { submitted.push(decision); return { approved: true }; };
        mountWithAccounts(ACCOUNTS);

        fireEvent.click(screen.getByRole('button', { name: /^Accounts it can see/ }));
        expect(screen.getByLabelText('Share Account 1').checked).toBe(true);
        expect(screen.getByLabelText('Share Account 2').checked).toBe(false);

        fireEvent.click(screen.getByLabelText('Share Account 2'));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });

        expect(submitted).toHaveLength(1);
        expect(submitted[0].accounts).toEqual(['acct-1', 'acct-2']);
        expect(submitted[0].canSignMessage).toBe(false);
    });

    it('keeps Approve enabled and reports a missing account without sending', async () => {
        mountWithAccounts(ACCOUNTS);
        fireEvent.click(screen.getByRole('button', { name: /^Accounts it can see/ }));
        fireEvent.click(screen.getByLabelText('Share Account 1'));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        const approve = screen.getByRole('button', { name: 'Approve' });
        expect(approve).not.toBeDisabled();
        fireEvent.click(approve);
        expect(await screen.findByTestId('connect-error-summary')).toHaveTextContent(
            'Fix 1 thing to continue',
        );
        expect(screen.getAllByRole('alert').some((alert) => (
            alert.textContent === 'Pick at least one account to share.'
        ))).toBe(true);
    });

    it('says the primary account is shared when no options arrive', async () => {
        const submitted = [];
        shim.resolveApproval = async (_id, decision) => { submitted.push(decision); return { approved: true }; };
        mountWithAccounts(undefined);

        expect(screen.getByText(/primary account/i)).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })); });
        expect(submitted[0].accounts).toEqual([]);
    });
});
