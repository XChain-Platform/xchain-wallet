// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Six Token Actions forms kept their own defaults after the shared helpers
// landed, so each carried one or both of the two defects the helpers exist
// to prevent:
//
//   CHAIN  - `Object.keys(byChain)[0]` is the wallet's OLDEST chain, since
//            `addresses.byChain` is built in address-creation order. A
//            wallet that started on Bitcoin opened Pay dividend on Bitcoin
//            after a whole session of Dogecoin work. `pickDefaultChainId`
//            reads the last-used chain the wallet already records.
//   SOURCE - a hand-rolled "newest HD external index" sort ignored the
//            chain's ACTIVE address, so a wallet that had just generated a
//            receive address paid the fee from an empty one - and on a
//            wallet with dispenser-delegated addresses that newest index is
//            a delegated address, which must never be a default fee payer.
//            `preferredSourceId` over a dispenser-filtered list fixes both.
//
// These drive the real forms, not the helpers alone, because the defect was
// never in a helper: it was the form not asking. Teeth: restore either
// hand-rolled default in a form and its row here fails.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { BroadcastForm } from '../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const LTC = 'litecoin-mainnet';

const hd = (chainPrefix, coinType, index, extra = {}) => ({
    id: `${chainPrefix}-${index}`,
    address: `${chainPrefix}1qindex${index}indexindexindexindexindexindex`,
    publicKey: `02a${index}`,
    derivationPath: `m/84'/${coinType}'/0'/0/${index}`,
    source: 'hd',
    signerId: 'signer-1',
    ...extra,
});

// Key order is creation order: Bitcoin first, then Dogecoin, then Litecoin.
// The old default read exactly this order.
const CHAIN_ADDRESSES = Object.freeze({
    [BTC]: [hd('bc', 0, 0)],
    [DOGE]: [hd('doge', 3, 0)],
    [LTC]: [hd('ltc', 2, 0)],
});
const CHAIN_ACTIVE = Object.freeze({
    [BTC]: { id: 'bc-0' }, [DOGE]: { id: 'doge-0' }, [LTC]: { id: 'ltc-0' },
});

const settingsWith = (lastUsedChain) => ({
    walletMode: 'full', activeNetwork: 'mainnet', lastUsedChain,
});

/**
 * A messaging stub whose unknown methods resolve to an empty rows payload,
 * so a form's incidental lookups (contacts, token records, holders) neither
 * throw nor have to be enumerated here.
 */
function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ ...CHAIN_ADDRESSES }),
        getActiveAddresses: vi.fn().mockResolvedValue({ ...CHAIN_ACTIVE }),
        getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: DOGE })),
        updateSettings: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        listActions: vi.fn().mockResolvedValue(['SEND', 'ISSUE']),
        listPendingAirdropsForWallet: vi.fn().mockResolvedValue([]),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({ rows: [] });
        },
        has: (t, prop) => prop in t,
    });
}

function mount(Form, props, messaging) {
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

// Every form in the group renders the chain through NetworkField, whose
// button names itself "Network: <display name>".
const chainName = async () => {
    const button = await screen.findByRole('button', { name: /^Network: / });
    return button.getAttribute('aria-label') || button.textContent;
};
const expectChain = async (displayName) => {
    await waitFor(async () => {
        expect(await chainName()).toMatch(new RegExp(`^Network: ${displayName}`));
    });
};

const CHAIN_FORMS = [
    { name: 'TokenAdminForm (Update description)', Form: TokenAdminForm, props: { mode: 'description' } },
    { name: 'TokenAdminForm (Lock)', Form: TokenAdminForm, props: { mode: 'lock' } },
    { name: 'TokenAdminForm (Transfer ownership)', Form: TokenAdminForm, props: { mode: 'transfer' } },
    { name: 'DividendForm', Form: DividendForm, props: {} },
    { name: 'IssueTokenForm', Form: IssueTokenForm, props: {} },
    { name: 'AirdropForm', Form: AirdropForm, props: {} },
    { name: 'BroadcastForm', Form: BroadcastForm, props: {} },
    { name: 'DispenserForm', Form: DispenserForm, props: {} },
];

describe.each(CHAIN_FORMS)('$name chain default', ({ Form, props }) => {
    it('opens on the last-used chain, not the first-created one', async () => {
        const messaging = mount(Form, props, messagingWith());
        await expectChain('Dogecoin');
        expect(messaging.getSettings).toHaveBeenCalled();
    });

    it('falls back to the first chain when the last-used chain has no addresses any more', async () => {
        mount(Form, props, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: 'dogecoin-testnet' })),
        }));
        await expectChain('Bitcoin');
    });

    it('never reads a testnet slot on a mainnet wallet', async () => {
        mount(Form, props, messagingWith({
            getSettings: vi.fn().mockResolvedValue(settingsWith({ testnet: 'dogecoin-testnet' })),
        }));
        await expectChain('Bitcoin');
    });

    it('still opens, on the first chain, when the settings read fails', async () => {
        mount(Form, props, messagingWith({
            getSettings: vi.fn().mockRejectedValue(new Error('vault locked')),
        }));
        await expectChain('Bitcoin');
    });
});

// A caller-seeded chain (the token context these forms are opened from)
// outranks the last-used chain: re-pointing a locked token at another chain
// would sign the action against a token that does not exist there.
describe('a locked token context keeps its own chain', () => {
    it.each([
        ['TokenAdminForm', TokenAdminForm, { mode: 'description' }],
        ['DividendForm', DividendForm, {}],
    ])('%s', async (_name, Form, props) => {
        mount(Form, { ...props, initialChainId: LTC, initialTick: 'XCP' }, messagingWith());
        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('ltc1qindex0indexindexindexindexindexindex'));
    });
});

// Source fixture: one chain, index 0 active, index 3 the newest personal
// address, index 4 a dispenser-delegated address (newest of all). The
// hand-rolled sort these two forms carried picked index 4.
const ACTIVE_ADDR = hd('bc', 0, 0);
const NEWEST_PERSONAL = hd('bc', 0, 3);
const DELEGATED = hd('bc', 0, 4, { role: 'dispenser' });
const SOURCE_ADDRESSES = Object.freeze({
    [BTC]: [ACTIVE_ADDR, NEWEST_PERSONAL, DELEGATED],
});

function sourceMessaging(activeByChain) {
    return messagingWith({
        getAddressesByChain: vi.fn().mockResolvedValue({ ...SOURCE_ADDRESSES }),
        getActiveAddresses: vi.fn().mockResolvedValue(activeByChain),
        getSettings: vi.fn().mockResolvedValue(settingsWith({ mainnet: BTC })),
    });
}

const SOURCE_FORMS = [
    { name: 'TokenAdminForm (Update description)', Form: TokenAdminForm, props: { mode: 'description' } },
    { name: 'TokenAdminForm (Lock)', Form: TokenAdminForm, props: { mode: 'lock' } },
    { name: 'TokenAdminForm (Transfer ownership)', Form: TokenAdminForm, props: { mode: 'transfer' } },
    { name: 'DividendForm', Form: DividendForm, props: {} },
];

const readFrom = async () => (await screen.findByLabelText('From')).value;

describe.each(SOURCE_FORMS)('$name source default', ({ Form, props }) => {
    it('defaults to the active address, not the newest one', async () => {
        const messaging = mount(Form, props, sourceMessaging({
            [BTC]: { id: ACTIVE_ADDR.id, address: ACTIVE_ADDR.address },
        }));
        await waitFor(async () => expect(await readFrom()).toBe(ACTIVE_ADDR.address));
        expect(messaging.getActiveAddresses).toHaveBeenCalled();
    });

    it('never defaults to a dispenser-delegated address, even as the active entry', async () => {
        mount(Form, props, sourceMessaging({
            [BTC]: { id: DELEGATED.id, address: DELEGATED.address },
        }));
        await waitFor(async () => expect(await readFrom()).toBe(NEWEST_PERSONAL.address));
    });

    it('falls back to the newest personal address when the host has no active map', async () => {
        mount(Form, props, sourceMessaging({}));
        await waitFor(async () => expect(await readFrom()).toBe(NEWEST_PERSONAL.address));
    });

    it('an explicit initialFromAddress still wins', async () => {
        mount(Form, { ...props, initialFromAddress: NEWEST_PERSONAL.address }, sourceMessaging({
            [BTC]: { id: ACTIVE_ADDR.id, address: ACTIVE_ADDR.address },
        }));
        await waitFor(async () => expect(await readFrom()).toBe(NEWEST_PERSONAL.address));
    });
});
