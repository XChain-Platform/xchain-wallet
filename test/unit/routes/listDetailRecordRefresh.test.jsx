// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A list beside (or under) its detail stays mounted while the detail writes
// a record, so it must read the record again when the write lands: rename an
// agent and the row shows the new name, Set active on an address and its row
// wears the Active badge, without reopening the page.

import React, { useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { useMessaging } from '../../../packages/core/src/shared/useMessaging.js';
import { CoSignerAccountList } from '../../../packages/core/src/shared/routes/CoSignerAccountList.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { writeWalletTile } from '../../../packages/core/src/shared/utils/walletTile.js';

const AGENT = {
    id: 'agent-1', walletId: 'wallet-1', name: 'Policy automation account', chainId: 'bitcoin-regtest',
    aggregateAddress: 'bcrt1pagentone000000000000000000000000000000', enabled: true,
};

let layoutWidth = 0;
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.hasAttribute('data-list-detail')) {
            return {
                width: layoutWidth, height: 800, top: 0, left: 0,
                right: layoutWidth, bottom: 800, x: 0, y: 0, toJSON() {},
            };
        }
        return realRect.call(this);
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    layoutWidth = 0;
    try { globalThis.localStorage?.clear(); } catch { /* storage can be unavailable */ }
});

function agentMessaging() {
    let stored = { ...AGENT };
    return {
        listCoSignerAccounts: vi.fn(async () => [{ ...stored }]),
        getCoSignerAccountBalances: vi.fn().mockResolvedValue({}),
        getCoSignerAccount: vi.fn(async () => ({ ...stored })),
        updateCoSignerAccount: vi.fn(async ({ patch }) => {
            stored = { ...stored, ...patch };
            return { ...stored };
        }),
    };
}

// The detail the shells render: it writes through the shared messaging and
// counts its own mounts, so a list refresh that remounts it is caught.
function AgentDetailStub({ accountId, mounts }) {
    const { messaging } = useMessaging();
    useEffect(() => { mounts.count += 1; }, [mounts]);
    return (
        <div>
            <button type="button" onClick={() => messaging.getCoSignerAccount({ id: accountId })}>Read agent</button>
            <button type="button" onClick={() => messaging.updateCoSignerAccount({ id: accountId, patch: { name: 'Treasury automation account' } })}>Rename agent</button>
            <button type="button" onClick={() => messaging.updateCoSignerAccount({ id: accountId, patch: { enabled: false } })}>Turn off agent</button>
        </div>
    );
}

function AgentShell({ mounts }) {
    const [selected, setSelected] = useState(null);
    return (
        <CoSignerAccountList
            walletId="wallet-1"
            onBack={() => {}}
            onProvision={() => {}}
            onOpen={() => {}}
            selectedAccountId={selected}
            onSelectAccount={setSelected}
            renderAccount={(id) => <AgentDetailStub accountId={id} mounts={mounts} />}
        />
    );
}

describe('two-panel list after its detail writes', () => {
    it('shows the renamed agent in the list without remounting the detail', async () => {
        layoutWidth = 1046;
        const messaging = agentMessaging();
        const mounts = { count: 0 };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AgentShell mounts={mounts} />
            </MessagingProvider>,
        );
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        expect(within(list).getByText('Policy automation account')).toBeInTheDocument();
        await waitFor(() => expect(mounts.count).toBe(1));
        expect(messaging.listCoSignerAccounts).toHaveBeenCalledTimes(1);

        // A detail read is not a write: the list does not read again.
        fireEvent.click(screen.getByRole('button', { name: 'Read agent' }));
        await waitFor(() => expect(messaging.getCoSignerAccount).toHaveBeenCalledTimes(1));
        await act(async () => { await Promise.resolve(); });
        expect(messaging.listCoSignerAccounts).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Rename agent' }));
        await waitFor(() => expect(within(screen.getByRole('list', { name: 'Agent accounts' }))
            .getByText('Treasury automation account')).toBeInTheDocument());
        expect(within(screen.getByRole('list', { name: 'Agent accounts' }))
            .queryByText('Policy automation account')).toBeNull();
        // One list read per write, and the balances the write cannot change stay as read.
        expect(messaging.listCoSignerAccounts).toHaveBeenCalledTimes(2);
        expect(messaging.getCoSignerAccountBalances).toHaveBeenCalledTimes(1);
        expect(mounts.count).toBe(1);
        expect(screen.getByRole('region', { name: 'Treasury automation account' })).toBeInTheDocument();
    });

    it('turns the Active pill off when the detail turns the agent off', async () => {
        layoutWidth = 1046;
        const messaging = agentMessaging();
        const mounts = { count: 0 };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AgentShell mounts={mounts} />
            </MessagingProvider>,
        );
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        expect(within(list).getByText('Active')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: 'Turn off agent' }));
        await waitFor(() => expect(within(screen.getByRole('list', { name: 'Agent accounts' }))
            .getByText('Turned off')).toBeInTheDocument());
        expect(mounts.count).toBe(1);
    });

    it('redraws the agent tile when Edit look saves a new shape', async () => {
        layoutWidth = 1046;
        const messaging = agentMessaging();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AgentShell mounts={{ count: 0 }} />
            </MessagingProvider>,
        );
        const list = await screen.findByRole('list', { name: 'Agent accounts' });
        const tile = () => list.querySelector('[data-agent-tile]');
        expect(tile().style.getPropertyValue('--xc-avatar-shape')).toBe('50%');

        act(() => { writeWalletTile(AGENT.id, { shape: 'rounded' }); });
        await waitFor(() => expect(tile().style.getPropertyValue('--xc-avatar-shape')).toBe('24%'));
        // A look lives on this device, so the list redraws without reading the agents again.
        expect(messaging.listCoSignerAccounts).toHaveBeenCalledTimes(1);
    });
});

const WALLET = { id: 'wallet-a', name: 'Main Wallet', format: 'bip39' };
const ACCOUNT = { id: 'account-a', index: 0, walletId: WALLET.id };
const CHAIN = 'bitcoin-regtest';
const FIRST = 'bcrt1qfirst00000000000000000000000000000000000';
const SECOND = 'bcrt1qsecond0000000000000000000000000000000000';

function addressMessaging() {
    let active = { [CHAIN]: { id: 'addr-1', address: FIRST } };
    const rows = [
        { id: 'addr-1', address: FIRST, label: 'First', source: 'hd', addressType: 'p2wpkh', role: 'receive', hidden: false, accountId: ACCOUNT.id },
        { id: 'addr-2', address: SECOND, label: 'Second', source: 'hd', addressType: 'p2wpkh', role: 'receive', hidden: false, accountId: ACCOUNT.id },
    ];
    return {
        listWallets: vi.fn().mockResolvedValue([WALLET]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        updateSettings: vi.fn().mockResolvedValue({ activeNetwork: 'regtest' }),
        listMultisigReceiveAddresses: vi.fn().mockResolvedValue([]),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: rows }),
        getActiveAddresses: vi.fn(async () => ({ ...active })),
        setActiveAddress: vi.fn(async (_account, chainId, id) => {
            const row = rows.find((r) => r.id === id);
            active = { ...active, [chainId]: { id, address: row.address } };
            return { ok: true };
        }),
    };
}

// The shells keep the open address on the history entry, and Back (which
// Set active calls) pops it, so the same AddressList shows its list again.
function AddressShell() {
    const [detail, setDetail] = useState(null);
    const detailRef = useRef(null);
    detailRef.current = detail;
    return (
        <AddressList
            walletId={WALLET.id}
            accountId={ACCOUNT.id}
            selectedAddress={detail}
            onSelectedAddressChange={setDetail}
            onBack={() => setDetail(null)}
            onDetailBack={() => setDetail(null)}
        />
    );
}

function rowFor(address) {
    return screen.getByRole('button', { name: `View address ${address}` });
}

describe('address list after Set active in its detail', () => {
    it('moves the Active badge to the address made active, without reopening Addresses', async () => {
        const messaging = addressMessaging();
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AddressShell />
            </MessagingProvider>,
        );
        await waitFor(() => expect(within(rowFor(FIRST)).getByText('Active')).toBeInTheDocument());
        expect(within(rowFor(SECOND)).queryByText('Active')).toBeNull();
        expect(messaging.getActiveAddresses).toHaveBeenCalledTimes(1);

        fireEvent.click(rowFor(SECOND));
        fireEvent.click(await screen.findByRole('button', { name: /^Set active/ }));

        await waitFor(() => expect(within(rowFor(SECOND)).getByText('Active')).toBeInTheDocument());
        expect(within(rowFor(FIRST)).queryByText('Active')).toBeNull();
        expect(messaging.getActiveAddresses).toHaveBeenCalledTimes(2);
    });

    it('reads the badges once more for a label save, not once per signal', async () => {
        const messaging = {
            ...addressMessaging(),
            setAddressLabel: vi.fn().mockResolvedValue({ ok: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <AddressShell />
            </MessagingProvider>,
        );
        await waitFor(() => expect(within(rowFor(FIRST)).getByText('Active')).toBeInTheDocument());
        expect(messaging.getActiveAddresses).toHaveBeenCalledTimes(1);

        fireEvent.click(rowFor(SECOND));
        fireEvent.click(await screen.findByRole('button', { name: /^Edit label/ }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Address label' }), { target: { value: 'Savings' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Label', exact: true }));

        await waitFor(() => expect(messaging.setAddressLabel).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(messaging.getActiveAddresses).toHaveBeenCalledTimes(2));
        await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); });
        expect(messaging.getActiveAddresses).toHaveBeenCalledTimes(2);
    });
});
