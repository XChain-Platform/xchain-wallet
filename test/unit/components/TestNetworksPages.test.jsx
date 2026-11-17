// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the Test Networks pages (operator picks 2026-11-14). The list holds
// only the networks this wallet uses; Add Network offers the inactive
// built-ins and Custom network; a network's page holds its actions with the
// reason any one is unavailable; the custom network form makes a descriptor
// the registry accepts; the faucet keeps a bounded, searchable history.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

let messaging;
let settings;
const fundActiveWalletFromMiner = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/flows/regtestFaucet.js', () => ({ fundActiveWalletFromMiner }));

const pages = await import('../../../packages/core/src/shared/components/settings/TestNetworksPages.jsx');
const {
    AddNetworkPage,
    CustomNetworkFormPage,
    FaucetPage,
    TestNetworkPage,
    TestNetworksPage,
    buildCustomDescriptor,
    parseEndpoint,
    testNetworkSectionFor,
} = pages;
const { FAUCET_HISTORY_KEY, forgetFaucetHistory, readFaucetHistory, recordFaucetRequest } = await import(
    '../../../packages/core/src/shared/utils/faucetHistory.js'
);
const { clearRemovedWalletStorage } = await import('../../../packages/core/src/shared/utils/wipeWalletStorage.js');

const FEE = { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true };
const CUSTOM_ID = 'pages-fork-regtest';

function addCustom() {
    const registry = defaultRegistry();
    const descriptor = buildCustomDescriptor(registry.get('bitcoin-regtest'), {
        name: 'Pages Fork',
        id: CUSTOM_ID,
        explorer: { defaultUrl: 'http://localhost', defaultPort: 18090 },
        encoder: { defaultUrl: 'http://localhost', defaultPort: 3033 },
    });
    registry.addCustom(descriptor);
    return descriptor;
}

beforeEach(() => {
    localStorage.clear();
    settings = {
        ...createDefaultSettings(),
        developerMode: true,
        activeNetwork: 'mainnet',
        fees: { 'bitcoin-regtest': FEE },
    };
    messaging = {
        listCustomChains: vi.fn(async () => ({ descriptors: [] })),
        getNewestAddress: vi.fn(async () => ({ address: 'bcrt1qnewestaddressforthefaucet0000000000' })),
        listSigners: vi.fn(async () => []),
    };
    fundActiveWalletFromMiner.mockReset();
    fundActiveWalletFromMiner.mockResolvedValue({ ok: true, txid: 'txid-1', address: 'bcrt1qpaid' });
});

afterEach(() => {
    cleanup();
    try { defaultRegistry().removeCustom(CUSTOM_ID); } catch { /* not added */ }
});

describe('Test Networks list', () => {
    it('lists only active built-ins and added custom networks, then Add Network', async () => {
        const descriptor = addCustom();
        messaging.listCustomChains = vi.fn(async () => ({ descriptors: [descriptor] }));
        const onOpen = vi.fn();
        render(<TestNetworksPage onOpen={onOpen} />);

        const list = await screen.findByRole('list', { name: 'On this wallet' });
        await within(list).findByRole('button', { name: /^Pages Fork/ });
        const names = within(list).getAllByRole('button').map((b) => b.textContent);
        expect(names[0]).toMatch(/^Bitcoin Regtest/);
        expect(names.some((n) => /Litecoin Regtest|Dogecoin Regtest/.test(n))).toBe(false);
        expect(names[names.length - 1]).toMatch(/^Add Network/);

        fireEvent.click(within(list).getByRole('button', { name: /^Pages Fork/ }));
        expect(onOpen).toHaveBeenCalledWith(`developer-test-network:${CUSTOM_ID}`);
        fireEvent.click(within(list).getByRole('button', { name: /^Add Network/ }));
        expect(onOpen).toHaveBeenCalledWith('developer-add-network');
    });

    it('keeps Add Network listed with its reason while Developer mode is off', () => {
        settings = { ...settings, developerMode: false };
        const onOpen = vi.fn();
        render(<TestNetworksPage onOpen={onOpen} />);
        expect(screen.getByText(/Developer mode is off/)).toBeTruthy();
        const add = screen.getByRole('button', { name: /^Add Network/ });
        expect(add).toHaveAttribute('aria-disabled', 'true');
        expect(add).toHaveTextContent('Turn on Developer mode first');
        fireEvent.click(add);
        expect(onOpen).not.toHaveBeenCalled();
    });
});

// Operator walk 2026-11-15: every item on Test Networks is a standard
// tappable row (icon, title, description, chevron) in a rounded list card.
describe('Test Networks rows', () => {
    it('draws every network, Add Network and the faucet as a full row in a rounded card', async () => {
        const descriptor = addCustom();
        messaging.listCustomChains = vi.fn(async () => ({ descriptors: [descriptor] }));
        const { container } = render(<TestNetworksPage onOpen={() => {}} />);
        await screen.findByRole('button', { name: /^Pages Fork/ });

        const cards = [
            screen.getByRole('list', { name: 'On this wallet' }),
            screen.getByRole('list', { name: 'Tools' }),
        ];
        for (const card of cards) {
            // The flat Settings surface strips a class border, so each card
            // carries its rounded surface inline.
            expect(card.style.border).toBe('1px solid var(--xc-border)');
            expect(card.style.borderRadius).toBe('var(--xc-radius-md)');
            expect(card.style.background).toBe('var(--xc-surface)');
            for (const row of within(card).getAllByRole('button')) {
                expect(row.closest('li')?.parentElement).toBe(card);
                expect(row.querySelector('svg, img, [aria-hidden="true"]')).not.toBeNull();
                expect(row.textContent.trim().length).toBeGreaterThan(0);
            }
        }
        // Every network row: its icon in the action-row icon box, its name,
        // its line and the chevron.
        const networkRows = container.querySelectorAll('[data-test-network]');
        expect(networkRows.length).toBe(2);
        for (const li of networkRows) {
            const row = li.querySelector('button, a');
            expect(row.querySelector('img, span[style*="--net-color"]')).not.toBeNull();
            expect(row.children.length).toBeGreaterThanOrEqual(3);
            expect(row.lastElementChild.getAttribute('aria-hidden')).toBe('true');
            expect(row.lastElementChild.querySelector('svg')).not.toBeNull();
        }
        expect(within(cards[0]).getByRole('button', { name: /^Bitcoin Regtest/ })).toHaveTextContent('Built-in');
        expect(within(cards[1]).getByRole('button', { name: /^Regtest Faucet/ })).toBeTruthy();
    });

    it('keeps the Test Networks page off the Settings card, so its own cards show', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync('packages/core/src/shared/routes/Settings.jsx', 'utf8');
        const flat = src.match(/const FLAT_GROUP_PAGES = new Set\(\[([\s\S]*?)\]\);/);
        expect(flat?.[1]).toMatch(/\bTEST_NETWORKS_PAGE_ID\b/);
    });
});

describe('Add Network', () => {
    it('lists only the inactive built-in regtest networks, with no group header', () => {
        const { container } = render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} />);
        expect(screen.queryByText('Built-in regtest')).toBeNull();
        expect(screen.queryByText('Your own')).toBeNull();
        expect(screen.queryByRole('button', { name: /^Custom network/ })).toBeNull();
        const card = screen.getByRole('list', { name: 'Add Network' });
        const names = within(card).getAllByRole('button').map((b) => b.textContent);
        expect(names).toHaveLength(2);
        expect(names[0]).toMatch(/^Dogecoin Regtest/);
        expect(names[1]).toMatch(/^Litecoin Regtest/);
        expect(screen.queryByRole('button', { name: /^Bitcoin Regtest/ })).toBeNull();
        // Nothing sits between the notices and the list: no group label.
        expect(container.querySelector('[class*="groupLabel"]')).toBeNull();
    });

    it('opens Add Custom Network from the plus in its title bar', () => {
        const onOpen = vi.fn();
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} onOpen={onOpen} onBack={() => {}} />);
        const heading = screen.getByRole('heading', { level: 1, name: 'Add Network' });
        const titleBar = heading.closest('div');
        const plus = within(titleBar).getByRole('button', { name: 'Add Custom Network' });
        expect(plus.querySelector('svg')).not.toBeNull();
        // The plus sits at the far right of the title line (G02, G95).
        const trailing = within(titleBar).getAllByRole('button');
        expect(trailing[trailing.length - 1]).toBe(plus);
        fireEvent.click(plus);
        expect(onOpen).toHaveBeenCalledWith('developer-add-custom-network');
    });

    it('keeps the plus off while Developer mode is off', () => {
        settings = { ...settings, developerMode: false };
        const onOpen = vi.fn();
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} onOpen={onOpen} />);
        const plus = screen.getByRole('button', { name: 'Add Custom Network' });
        expect(plus).toBeDisabled();
        fireEvent.click(plus);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('draws its own screen so Settings hands it Back', () => {
        expect(testNetworkSectionFor('developer-add-network')).toMatchObject({ ownsScreen: true, Component: AddNetworkPage });
    });

    it('activates the tapped network and returns to Test Networks', async () => {
        messaging.signerReady = vi.fn(async () => ({ ready: true }));
        messaging.activateChainRequest = vi.fn(async () => ({ addresses: [{ accountId: 'a1' }] }));
        const onReturnTo = vi.fn();
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} onReturnTo={onReturnTo} />);
        const row = screen.getByRole('button', { name: /^Dogecoin Regtest/ });
        await waitFor(() => expect(row).toHaveTextContent('Activate on this wallet'));
        fireEvent.click(row);
        await waitFor(() => expect(messaging.activateChainRequest).toHaveBeenCalledOnce());
        expect(messaging.activateChainRequest.mock.calls[0][0]).toMatchObject({ walletId: 'wallet-1', chainId: 'dogecoin-regtest' });
        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
    });

    it('asks for the password in place and names a wrong one', async () => {
        messaging.activateChainRequest = vi.fn(async () => {
            const err = new Error('bad');
            err.name = 'InvalidPasswordError';
            throw err;
        });
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} />);
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Litecoin Regtest/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Activate Network' }));
        expect(await screen.findByText('Enter your wallet password to activate.')).toBeTruthy();
        expect(messaging.activateChainRequest).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'nope' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate Network' }));
        expect(await screen.findByText('Wrong wallet password. Try again.')).toBeTruthy();
    });

    // Operator preference 2026-11-14: with the session's unlocked signer
    // pooled (wallet.signerReady), a tap activates at once, no password.
    it('activates at once with no password field while the signer is pooled', async () => {
        messaging.signerReady = vi.fn(async () => ({ ready: true }));
        messaging.activateChainRequest = vi.fn(async () => ({ addresses: [{ accountId: 'a1' }] }));
        const onReturnTo = vi.fn();
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} onReturnTo={onReturnTo} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Litecoin Regtest/ })).toHaveTextContent('Activate on this wallet'));

        fireEvent.click(screen.getByRole('button', { name: /^Litecoin Regtest/ }));
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
        expect(messaging.activateChainRequest).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            chainId: 'litecoin-regtest',
            password: undefined,
            signerId: undefined,
        });
    });

    it('falls back to the password in place when the pool emptied after the page read it', async () => {
        messaging.signerReady = vi.fn(async () => ({ ready: true }));
        messaging.activateChainRequest = vi.fn()
            .mockRejectedValueOnce(new Error('activateChain: either `signer` or `password` is required'))
            .mockResolvedValue({ addresses: [] });
        const onReturnTo = vi.fn();
        render(<AddNetworkPage activeWallet={{ id: 'wallet-1' }} onReturnTo={onReturnTo} />);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Litecoin Regtest/ })).toHaveTextContent('Activate on this wallet'));

        fireEvent.click(screen.getByRole('button', { name: /^Litecoin Regtest/ }));
        expect(await screen.findByText('Enter your wallet password to activate.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate Network' }));
        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
        expect(messaging.activateChainRequest.mock.calls[1][0]).toMatchObject({ chainId: 'litecoin-regtest', password: 'secret' });
    });

    it('activates a custom network from its page at once while the signer is pooled', async () => {
        settings = { ...settings, fees: {} };
        addCustom();
        messaging.signerReady = vi.fn(async () => ({ ready: true }));
        messaging.activateChainRequest = vi.fn(async () => ({ addresses: [{ accountId: 'a1' }] }));
        render(<TestNetworkPage chainId={CUSTOM_ID} activeWallet={{ id: 'wallet-1' }} />);
        await waitFor(() => expect(messaging.signerReady).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: /^Activate on this wallet/ }));
        await waitFor(() => expect(messaging.activateChainRequest).toHaveBeenCalledOnce());
        expect(messaging.activateChainRequest.mock.calls[0][0]).toMatchObject({ chainId: CUSTOM_ID, password: undefined });
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
    });
});

describe('a network page', () => {
    it('gives a built-in network its actions, the faucet live once active', () => {
        const onOpen = vi.fn();
        render(<TestNetworkPage chainId="bitcoin-regtest" activeWallet={{ id: 'wallet-1' }} onOpen={onOpen} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Bitcoin Regtest' })).toBeTruthy();
        const guidance = screen.getByText("Built-in networks can't be edited or removed.").closest('[data-variant]');
        expect(guidance).not.toBeNull();
        expect(guidance.compareDocumentPosition(document.querySelector('[data-identity-card]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Actions/ })).toHaveAttribute('aria-selected', 'true');
        const actions = screen.getByRole('list', { name: 'Network actions' });
        const getCoins = within(actions).getByRole('button', { name: /^Get test coins/ });
        expect(getCoins).toHaveTextContent('Ask the local miner for BTC');
        expect(getCoins.querySelector('svg')).not.toBeNull();
        expect(getCoins.lastElementChild).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByRole('button', { name: /^Edit network/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Remove network/ })).toBeNull();
        fireEvent.click(getCoins);
        expect(onOpen).toHaveBeenCalledWith('developer-faucet:bitcoin-regtest');
        fireEvent.click(screen.getByRole('button', { name: /^Switch wallet to Regtest/ }));
        expect(onOpen).toHaveBeenCalledWith('network-active');
    });

    it('says in words why an action is unavailable', () => {
        addCustom();
        settings = { ...settings, activeNetwork: 'regtest', fees: { ...settings.fees, [CUSTOM_ID]: FEE } };
        render(<TestNetworkPage chainId={CUSTOM_ID} activeWallet={{ id: 'wallet-1' }} />);
        expect(screen.getByRole('button', { name: /^Switch wallet to Regtest/ })).toHaveTextContent('The wallet is on Regtest now');
        expect(screen.getByRole('button', { name: /^Edit network/ })).toHaveTextContent('This wallet holds addresses on it, so it stays unchanged');
        expect(screen.getByRole('button', { name: /^Remove network/ })).toHaveAttribute('aria-disabled', 'true');
    });

    // Addresses name a network by coin and kind, so a guided copy of Bitcoin
    // Regtest shares its addresses: the host refuses its removal while they
    // exist, and the rows say so before anyone presses them.
    it('says a guided copy stays while the network it copies is active', () => {
        addCustom();
        render(<TestNetworkPage chainId={CUSTOM_ID} activeWallet={{ id: 'wallet-1' }} />);
        const remove = screen.getByRole('button', { name: /^Remove network/ });
        expect(remove).toHaveAttribute('aria-disabled', 'true');
        expect(remove).toHaveTextContent('It shares the addresses of Bitcoin Regtest, so it stays while Bitcoin Regtest is active');
        expect(screen.getByRole('button', { name: /^Edit network/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('waits for the first settings read before judging any network', () => {
        settings = null;
        render(<TestNetworksPage />);
        expect(screen.getByText('Loading…')).toBeTruthy();
        expect(screen.queryByText(/Developer mode is off/)).toBeNull();
        expect(screen.queryByRole('button', { name: /^Add Network/ })).toBeNull();
    });

    it('removes an unused custom network and returns to the list', async () => {
        settings = { ...settings, fees: {} };
        addCustom();
        messaging.removeCustomChain = vi.fn(async () => ({ removed: true }));
        const onReturnTo = vi.fn();
        render(<TestNetworkPage chainId={CUSTOM_ID} activeWallet={{ id: 'wallet-1' }} onReturnTo={onReturnTo} />);
        expect(screen.getByRole('button', { name: /^Get test coins/ })).toHaveTextContent('Activate this network first');
        fireEvent.click(screen.getByRole('button', { name: /^Remove network/ }));
        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
        expect(messaging.removeCustomChain).toHaveBeenCalledWith({ chainId: CUSTOM_ID });
        expect(defaultRegistry().has(CUSTOM_ID)).toBe(false);
    });

    it('resolves the per-network page ids', () => {
        expect(testNetworkSectionFor('developer-test-network:bitcoin-regtest')).toMatchObject({ title: 'Bitcoin Regtest', ownsScreen: true, Component: TestNetworkPage });
        expect(testNetworkSectionFor('developer-faucet:bitcoin-regtest')).toMatchObject({ ownsScreen: true, props: { chainId: 'bitcoin-regtest' } });
        expect(testNetworkSectionFor('developer-add-network')).toMatchObject({ title: 'Add Network' });
        expect(testNetworkSectionFor('nope')).toBeNull();
    });
});

describe('the custom network form', () => {
    it.each(['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest'])(
        'makes a descriptor the registry accepts from %s',
        (baseId) => {
            const base = defaultRegistry().get(baseId);
            const descriptor = buildCustomDescriptor(base, {
                name: 'Lab Net',
                id: `lab-${baseId}`,
                explorer: parseEndpoint('http://localhost:18090'),
                encoder: parseEndpoint('http://127.0.0.1:3033/LAB'),
                hub: parseEndpoint('http://localhost:10010'),
                color: '#7C3AED',
                ticker: 'LAB',
            });
            expect(validateChainDescriptor(descriptor)).toEqual({ ok: true, errors: [] });
            expect(descriptor.isUserAdded).toBeUndefined();
            expect(descriptor.encoder).toEqual({ defaultUrl: 'http://127.0.0.1/LAB', defaultPort: 3033 });
        },
    );

    it('refuses a network ID another network uses, naming it', async () => {
        messaging.addCustomChain = vi.fn();
        render(<CustomNetworkFormPage />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Network name' }), { target: { value: 'Lab' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Network ID' }), { target: { value: 'bitcoin-regtest' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Network' }));
        const summary = await screen.findByRole('alert', { name: 'Form errors' });
        expect(within(summary).getByText(/Bitcoin Regtest already uses this ID\. Pick another, such as bitcoin-lab-regtest\./)).toBeTruthy();
        expect(messaging.addCustomChain).not.toHaveBeenCalled();
    });

    it('owns its title bar and reports every invalid field in the top notice', async () => {
        expect(testNetworkSectionFor('developer-add-custom-network')).toMatchObject({ ownsScreen: true, Component: CustomNetworkFormPage });
        render(<CustomNetworkFormPage onBack={() => {}} backLabel="Back to networks" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Add Custom Network' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Back to networks' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Add Network' }));
        const summary = await screen.findByRole('alert', { name: 'Form errors' });
        expect(summary).toHaveTextContent('Fix 2 things to continue');
        expect(summary).toHaveTextContent('Enter a name for the network');
        expect(summary).toHaveTextContent('Use lowercase letters, digits and single hyphens');
        expect(document.querySelector('[data-form-status]')).toContainElement(summary);

        const name = screen.getByRole('textbox', { name: 'Network name' });
        expect(name).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(name, { target: { value: 'Lab' } });
        expect(name).not.toHaveAttribute('aria-invalid', 'true');
        expect(summary).not.toHaveTextContent('Enter a name for the network');
    });

    it('adds the guided network, mirrors it here and returns to the list', async () => {
        messaging.addCustomChain = vi.fn(async ({ descriptor }) => ({ descriptor }));
        const onReturnTo = vi.fn();
        render(<CustomNetworkFormPage onReturnTo={onReturnTo} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Network name' }), { target: { value: 'Pages Fork' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Network ID' }), { target: { value: CUSTOM_ID } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Network' }));
        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
        const sent = messaging.addCustomChain.mock.calls[0][0].descriptor;
        expect(sent).toMatchObject({ id: CUSTOM_ID, displayName: 'Pages Fork', coin: 'bitcoin', networkKind: 'regtest' });
        expect(validateChainDescriptor(sent).ok).toBe(true);
        expect(defaultRegistry().has(CUSTOM_ID)).toBe(true);
    });
});

describe('Edit Network', () => {
    it('owns its title bar and puts its explanation in the top notice', () => {
        settings = { ...settings, fees: {} };
        addCustom();
        expect(testNetworkSectionFor(`developer-edit-custom-network:${CUSTOM_ID}`)).toMatchObject({ ownsScreen: true, Component: CustomNetworkFormPage });
        render(<CustomNetworkFormPage editChainId={CUSTOM_ID} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Edit Network' })).toBeTruthy();
        const explanation = screen.getByText('Edits keep its keys, address types and fee rules.');
        const notice = explanation.closest('[data-variant]');
        expect(notice).not.toBeNull();
        const form = screen.getByRole('form', { name: 'Edit Network' });
        expect(form).toContainElement(notice);
        expect(notice.compareDocumentPosition(form.querySelector('[data-form-sections]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('replaces the network with the edited descriptor and returns to the list', async () => {
        settings = { ...settings, fees: {} };
        addCustom();
        messaging.removeCustomChain = vi.fn(async () => ({ removed: true }));
        messaging.addCustomChain = vi.fn(async ({ descriptor }) => ({ descriptor }));
        const onReturnTo = vi.fn();
        render(<CustomNetworkFormPage editChainId={CUSTOM_ID} onReturnTo={onReturnTo} />);
        const name = screen.getByRole('textbox', { name: 'Network name' });
        expect(name).toHaveValue('Pages Fork');
        fireEvent.change(name, { target: { value: 'Pages Fork Two' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Network' }));

        await waitFor(() => expect(onReturnTo).toHaveBeenCalledWith('developer-test-networks'));
        expect(messaging.removeCustomChain).toHaveBeenCalledWith({ chainId: CUSTOM_ID });
        expect(messaging.addCustomChain).toHaveBeenCalledOnce();
        expect(messaging.addCustomChain.mock.calls[0][0].descriptor).toMatchObject({ id: CUSTOM_ID, displayName: 'Pages Fork Two' });
        expect(defaultRegistry().get(CUSTOM_ID)?.displayName).toBe('Pages Fork Two');
    });

    it('puts the old descriptor back when the edited one is refused', async () => {
        settings = { ...settings, fees: {} };
        addCustom();
        messaging.removeCustomChain = vi.fn(async () => ({ removed: true }));
        messaging.addCustomChain = vi.fn()
            .mockRejectedValueOnce(new Error('addCustomChain: hub: must be a well-formed https/wss endpoint'))
            .mockImplementation(async ({ descriptor }) => ({ descriptor }));
        const onReturnTo = vi.fn();
        render(<CustomNetworkFormPage editChainId={CUSTOM_ID} onReturnTo={onReturnTo} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'Network name' }), { target: { value: 'Broken Fork' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Network' }));

        expect(await screen.findByText('Hub: must be a well-formed https/wss endpoint.')).toBeTruthy();
        expect(messaging.addCustomChain).toHaveBeenCalledTimes(2);
        expect(messaging.addCustomChain.mock.calls[1][0].descriptor).toMatchObject({ id: CUSTOM_ID, displayName: 'Pages Fork' });
        expect(messaging.addCustomChain.mock.calls[1][0].descriptor.isUserAdded).toBeUndefined();
        expect(defaultRegistry().get(CUSTOM_ID)?.displayName).toBe('Pages Fork');
        expect(onReturnTo).not.toHaveBeenCalled();
    });
});

describe('the regtest faucet', () => {
    it('records each request and lists this wallet history newest first, searchable', async () => {
        recordFaucetRequest({ walletId: 'other', chainId: 'bitcoin-regtest', amount: '1', ticker: 'BTC', status: 'sent', at: 5 });
        recordFaucetRequest({ walletId: 'wallet-1', chainId: 'bitcoin-regtest', amount: '3', ticker: 'BTC', address: 'bcrt1qolder', status: 'failed', error: 'Miner offline', at: 10 });
        render(<FaucetPage activeWallet={{ id: 'wallet-1' }} activeAccount={{ id: 'account-1' }} />);

        fireEvent.click(screen.getByRole('button', { name: 'Get Test Coins' }));
        await waitFor(() => expect(fundActiveWalletFromMiner).toHaveBeenCalledOnce());
        expect(await screen.findByText(/Sent 10 BTC to bcrt1qpaid/)).toBeTruthy();
        expect(screen.getByRole('list', { name: 'Last request' })).toHaveTextContent('10 BTC');

        // The filter sits in the title bar on History.
        expect(screen.queryByRole('button', { name: 'Filter faucet history' })).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: /History/ }));
        const list = screen.getByRole('list', { name: 'Faucet history' });
        const rows = within(list).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('10 BTC');
        expect(rows[0]).toHaveTextContent('Paid');
        expect(rows[1]).toHaveTextContent('3 BTC');
        expect(rows[1]).toHaveTextContent('Failed');
        expect(screen.getByRole('button', { name: 'Filter faucet history' })).toBeTruthy();
    });

    it('keeps one store key bounded to the newest 100 entries', () => {
        for (let i = 0; i < 105; i += 1) {
            recordFaucetRequest({ walletId: 'wallet-1', chainId: 'bitcoin-regtest', amount: String(i), ticker: 'BTC', status: 'sent', at: 1000 + i });
        }
        const stored = JSON.parse(localStorage.getItem(FAUCET_HISTORY_KEY));
        expect(stored).toHaveLength(100);
        const mine = readFaucetHistory('wallet-1');
        expect(mine[0].amount).toBe('104');
        expect(mine[99].amount).toBe('5');
        expect(readFaucetHistory('nobody')).toEqual([]);
    });

    it('forgets a removed wallet entries and keeps the others', () => {
        recordFaucetRequest({ walletId: 'gone', chainId: 'bitcoin-regtest', amount: '1', ticker: 'BTC', status: 'sent', at: 1 });
        recordFaucetRequest({ walletId: 'kept', chainId: 'bitcoin-regtest', amount: '2', ticker: 'BTC', status: 'sent', at: 2 });
        clearRemovedWalletStorage('gone');
        expect(readFaucetHistory('gone')).toEqual([]);
        expect(readFaucetHistory('kept')).toHaveLength(1);
        forgetFaucetHistory('kept');
        expect(readFaucetHistory('kept')).toEqual([]);
    });

    it('says why there is nothing to fund before any regtest network is active', () => {
        settings = { ...settings, fees: {} };
        render(<FaucetPage activeWallet={{ id: 'wallet-1' }} activeAccount={{ id: 'account-1' }} />);
        expect(screen.getByText('No regtest network is active on this wallet')).toBeTruthy();
    });
});
