// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (xchain-wallet#34). From a contract stake position's detail page, the
// Unstake / Delegate / Add stake quick actions opened ContractStakeForm with
// only the action radio preselected. The form fell back to its own generic
// defaults - token XCHAIN, an empty signing pubkey, and whichever address the
// chain's active-address default picked as From - so every one of those
// buttons made the user re-enter the position's own token, pubkey and source
// by hand. For a position staked in a token other than XCHAIN the shortcut
// landed the user on a form that did not match the position at all.
//
// These mount ContractStakeForm directly (the level StakeDetail's quick
// actions ultimately hand off to) and assert the seeded field values, the
// same way IssueTokenForm.initialMint.test.jsx checks composed behavior
// rather than the callers that reach it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
// The contract-stake route: the one Staking form on a contract target.
import { ContractStakeRoute as ContractStakeForm } from '../../helpers/stakingFormRoutes.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const CONTRACT_INDEX = '2048';

// Two of the wallet's own addresses on the target chain: ACTIVE is what
// preferredSourceId would pick with no seed at all, and POSITION is the
// staker address a real position would carry - distinct on purpose, so a
// test that finds POSITION selected can only have gotten there through
// initialFromAddress, never through the ordinary active-address default.
const ACTIVE_ADDRESS = 'bcrt1qactiveactiveactiveactiveactiveactive0';
const POSITION_ADDRESS = 'bcrt1qpositionpositionpositionpositionposit';
const ADDRESSES = {
    [CHAIN]: [
        {
            id: 'addr-active',
            address: ACTIVE_ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/1'/0'/0/0",
            source: 'hd',
        },
        {
            id: 'addr-position',
            address: POSITION_ADDRESS,
            publicKey: '02cd',
            derivationPath: "m/84'/1'/0'/0/1",
            source: 'hd',
        },
    ],
};

const POSITION_PUBKEY = '03f0e1d2c3b4a5968778695a4b3c2d1e0fa1b2c3d4e5f60718293a4b5c6d7e8f9';

// `walletMode` among the extras is the mode of wallet `w`, published the way the
// shell does from the wallet list; every other entry is a messaging method.
function mountForm(props = {}, { walletMode = 'full', ...messagingExtra } = {}) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        // Shaped like the real host's getActiveAddresses(): a map of chainId
        // to { id, address }, which is what activeSourceId() matches against.
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-active', address: ACTIVE_ADDRESS } }),
        // A stakeable contract: cooldown_blocks present is what makes
        // contractMeta.valid true and lets the real form (not the "not
        // stakeable" error screen) render.
        getContractByActionIndex: vi.fn().mockResolvedValue({
            row: { cooldown_blocks: 10, slash_destination: 'bcrt1qslashdestinationexampleexampleexample' },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        ...messagingExtra,
    };
    // Anything else the form's hooks reach for (native-fee quotes, staked
    // balance lookups) answers empty rather than throwing: this suite is
    // about the seeded fields, not those side lookups.
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ContractStakeForm, {
                walletId: 'w',
                chainId: CHAIN,
                contractActionIndex: CONTRACT_INDEX,
                onBack() {},
                ...props,
            }),
        ),
    );
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    __clearTokenInfoCache();
});

describe('ContractStakeForm seeds from the position that opened it', () => {
    it('seeds token, signing pubkey and From from a non-XCHAIN position', async () => {
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: POSITION_PUBKEY,
            initialFromAddress: POSITION_ADDRESS,
        });

        // Token: TokenField's accessible name carries the current selection,
        // e.g. "Token: PEPECASH on <chain>" - never the XCHAIN default.
        const tokenField = await screen.findByRole('button', { name: /^Token: PEPECASH/ });
        expect(tokenField).toBeTruthy();

        // Signing pubkey: pre-filled with the position's key, not blank.
        const pubkeyField = screen.getByLabelText(/signing key$/i, { selector: 'input' });
        expect(pubkeyField.value).toBe(POSITION_PUBKEY);

        // From: the position's own address, not whichever address the
        // active-address default would otherwise have picked.
        // The standard From section labels the field "From address".
        const fromField = await screen.findByLabelText('From address');
        expect(fromField.value).toBe(POSITION_ADDRESS);
    });

    it('falls back to today\'s defaults when no initial props are given', async () => {
        mountForm({ initialMode: 'stake' });

        const tokenField = await screen.findByRole('button', { name: /^Token: XCHAIN/ });
        expect(tokenField).toBeTruthy();

        const pubkeyField = screen.getByLabelText(/signing key$/i, { selector: 'input' });
        expect(pubkeyField.value).toBe('');

        // No initialFromAddress: the ordinary active-address default wins.
        // The standard From section labels the field "From address".
        const fromField = await screen.findByLabelText('From address');
        expect(fromField.value).toBe(ACTIVE_ADDRESS);
        // The shared Advanced section sits directly above Speed and Fees.
        const ids = [...document.querySelectorAll('[data-form-section]')].map((n) => n.getAttribute('data-form-section'));
        expect(ids.slice(-2)).toEqual(['advanced', 'fee']);
    });
});

describe('ContractStakeForm unstake availability', () => {
    it('bounds unstake by tip-effective contract positions only', async () => {
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: POSITION_PUBKEY,
            initialFromAddress: POSITION_ADDRESS,
        }, {
            getContractStakesForAddress: vi.fn().mockResolvedValue([
                {
                    target_contract_index: CONTRACT_INDEX,
                    tick: 'PEPECASH',
                    signing_pubkey: POSITION_PUBKEY,
                    amount: '100',
                    status: 'valid',
                    activation_block: 1,
                    deactivation_block: 90,
                },
                {
                    target_contract_index: CONTRACT_INDEX,
                    tick: 'PEPECASH',
                    signing_pubkey: POSITION_PUBKEY,
                    amount: '7',
                    status: 'valid',
                    activation_block: 95,
                    deactivation_block: null,
                },
            ]),
            getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        });

        expect(await screen.findByText('7 PEPECASH staked')).toBeInTheDocument();
    });

    it('matches a stored lowercase signing key case-insensitively and refuses a different key', async () => {
        const storedKey = 'abcdef0123456789'.repeat(4);
        const mixedKey = 'AbCdEf0123456789'.repeat(4);
        const pendingStakeLookups = [];
        const getContractStakesForAddress = vi.fn(() => new Promise((resolve) => {
            pendingStakeLookups.push(resolve);
        }));
        const row = {
            target_contract_index: CONTRACT_INDEX,
            tick: 'PEPECASH',
            signing_pubkey: storedKey,
            amount: '11',
        };
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: storedKey.toUpperCase(),
            initialFromAddress: POSITION_ADDRESS,
        }, { getContractStakesForAddress });

        await waitFor(() => expect(pendingStakeLookups).toHaveLength(1));
        await act(async () => { pendingStakeLookups[0]([row]); });
        expect(await screen.findByText('11 PEPECASH staked')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Signing Key'), {
            target: { value: mixedKey },
        });
        await waitFor(() => expect(pendingStakeLookups).toHaveLength(2));
        await act(async () => { pendingStakeLookups[1]([row]); });
        expect(await screen.findByText('11 PEPECASH staked')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Signing Key'), {
            target: { value: 'f'.repeat(64) },
        });
        await waitFor(() => expect(pendingStakeLookups).toHaveLength(3));
        await act(async () => { pendingStakeLookups[2]([row]); });
        await waitFor(() => expect(screen.queryByText('11 PEPECASH staked')).not.toBeInTheDocument());
    });
});

describe('ContractStakeForm stake amount validation', () => {
    it('blocks a stake larger than the source token balance', async () => {
        mountForm({ initialMode: 'stake' }, {
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ACTIVE_ADDRESS,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'XCHAIN', quantity: '5', divisibility: 0 }],
                    },
                }],
            }),
        });

        expect(await screen.findByText('5 XCHAIN available')).toBeInTheDocument();
        fireEvent.change(await screen.findByLabelText('Amount (XCHAIN)'), { target: { value: '6' } });
        fireEvent.change(screen.getByLabelText('Signing Key'), {
            target: { value: 'a'.repeat(64) },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Amount exceeds the 5 XCHAIN available.');
    });

    it('shows blank and zero amount errors before compose', async () => {
        mountForm({ initialMode: 'stake', initialSigningPubkey: 'a'.repeat(64) });
        const submit = await screen.findByRole('button', { name: 'Stake' });
        fireEvent.click(submit);
        expect(await screen.findByRole('alert')).toHaveTextContent('Amount must be a positive decimal.');

        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '0' } });
        fireEvent.click(submit);
        expect(await screen.findByRole('alert')).toHaveTextContent('Amount must be a positive decimal.');
    });

    it('rejects amount beyond the token precision before compose', async () => {
        const getTokenInfo = vi.fn().mockResolvedValue({ divisibility: 2 });
        mountForm({
            initialMode: 'stake',
            initialSigningPubkey: 'a'.repeat(64),
        }, { getTokenInfo });
        await screen.findByLabelText('Amount (XCHAIN)');
        await waitFor(() => expect(getTokenInfo).toHaveBeenCalled());
        fireEvent.change(screen.getByLabelText('Amount (XCHAIN)'), { target: { value: '1.234' } });

        expect(await screen.findByText('Amount can have at most 2 decimal places.'))
            .toBeInTheDocument();
    });

    it('rejects a malformed contract ID before compose', async () => {
        mountForm({
            contractActionIndex: '0',
            initialMode: 'stake',
            initialSigningPubkey: 'a'.repeat(64),
        });
        fireEvent.click(await screen.findByRole('button', { name: 'Stake' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Contract ID must be a positive whole number.');
    });

    it('turns an indexer metadata failure into plain copy', async () => {
        const failure = new Error('Explorer returned HTTP 502 for /RBTC/api/contract/2048');
        failure.name = 'SDKExplorerError';
        mountForm({}, {
            getContractByActionIndex: vi.fn().mockRejectedValue(failure),
        });

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load contract metadata.");
        expect(alert).not.toHaveTextContent('/RBTC/api/contract/2048');
    });

    it('keeps the exact stake values when Back returns from review', async () => {
        const signingPubkey = 'a'.repeat(64);
        mountForm({
            initialMode: 'stake',
            initialSigningPubkey: signingPubkey,
        }, {
            walletMode: 'watcher',
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ACTIVE_ADDRESS,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'XCHAIN', quantity: '5', divisibility: 8 }],
                    },
                }],
            }),
        });
        fireEvent.change(await screen.findByLabelText('Amount (XCHAIN)'), {
            target: { value: '2.50000000' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));

        expect(await screen.findByRole('form', { name: 'Stake review' })).toBeInTheDocument();
        expect(screen.getByText('Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.')).toBeInTheDocument();
        expect(screen.getByText('2.50000000 XCHAIN')).toBeInTheDocument();
        expect(screen.getByText('10 blocks')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));

        expect(await screen.findByLabelText('Amount (XCHAIN)')).toHaveValue('2.50000000');
        expect(screen.getByLabelText('Signing Key')).toHaveValue(signingPubkey);
    });
});

describe('ContractStakeForm exact partial unstake', () => {
    it('keeps a one-atomic-unit-smaller unstake partial', async () => {
        const signingPubkey = 'a'.repeat(64);
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        mountForm({
            initialMode: 'unstake',
            initialTick: 'PEPECASH',
            initialSigningPubkey: signingPubkey,
            initialFromAddress: POSITION_ADDRESS,
        }, {
            getContractStakesForAddress: vi.fn().mockResolvedValue([{
                target_contract_index: CONTRACT_INDEX,
                tick: 'PEPECASH',
                signing_pubkey: signingPubkey,
                amount: '90071992.54740902',
            }]),
            composeForConfirm,
        });

        expect(await screen.findByText('90,071,992.54740902 PEPECASH staked'))
            .toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/^Amount/), {
            target: { value: '90071992.54740901' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Unstake' }));

        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData.params.AMOUNT)
            .toBe('90071992.54740901');
    });
});

describe('ContractStakeForm penalty warning', () => {
    it('tells the staker in plain words that the contract can take their staked tokens', async () => {
        mountForm({
            initialMode: 'stake',
            initialSigningPubkey: 'a'.repeat(64),
        }, {
            walletMode: 'watcher',
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: ACTIVE_ADDRESS,
                    balances: {
                        native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                        tokens: [{ tick: 'XCHAIN', quantity: '5', divisibility: 8 }],
                    },
                }],
            }),
        });
        // The form itself no longer shows the penalty destination; the
        // review states the risk.
        expect(await screen.findByRole('group', { name: 'Stake On' })).toBeInTheDocument();
        expect(screen.queryByText('Penalty destination')).toBeNull();
        expect(screen.queryByText('Slashed funds')).not.toBeInTheDocument();

        fireEvent.change(await screen.findByLabelText('Amount (XCHAIN)'), {
            target: { value: '1' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Stake' }));

        const review = await screen.findByRole('form', { name: 'Stake review' });
        expect(review).toHaveTextContent('Penalty risk');
        expect(review).toHaveTextContent('This contract can take some or all of your staked tokens as a penalty.');
        expect(review).toHaveTextContent('Penalties are sent to');
        expect(review).not.toHaveTextContent(/slash/i);
    });
});

describe('ContractStakeForm in the one Staking form (Layout 1)', () => {
    const namedContract = () => ({
        getContractByActionIndex: vi.fn().mockResolvedValue({
            row: {
                cooldown_blocks: 288,
                slash_destination: 'bcrt1qslashdestinationexampleexampleexample',
                meta_name: 'Yield Vault',
            },
        }),
    });

    it('keeps a fixed title and opens the main section on Stake On with the cooldown hint', async () => {
        mountForm({ initialMode: 'stake' }, namedContract());

        const stakeOn = await screen.findByRole('group', { name: 'Stake On' });
        expect(screen.getByRole('heading', { name: 'Stake' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /2048|Yield Vault/ })).toBeNull();
        expect(stakeOn).toHaveTextContent('Yield Vault#2048');
        // 288 Bitcoin blocks at the 10-minute target.
        expect(stakeOn).toHaveAccessibleDescription('Unstaking takes about 2 days (288 blocks)');
        expect(screen.getByRole('button', { name: 'Choose what to stake on' })).toBeInTheDocument();

        // The toggle is the main section's first field (ruling 2026-11-13),
        // then Stake On, then the Token, Amount and Signing Key fields.
        const main = stakeOn.closest('[data-form-section="main"]');
        expect(screen.getByRole('button', { name: 'Staking' })).toHaveAttribute('aria-expanded', 'true');
        const order = [
            within(main).getByRole('radiogroup', { name: 'Action' }),
            stakeOn,
            within(main).getByRole('button', { name: /^Token:/ }),
            within(main).getByLabelText(/^Amount/),
            within(main).getByLabelText('Signing Key'),
        ];
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        expect(within(main).getAllByRole('radio').map((radio) => radio.textContent))
            .toEqual(['Stake', 'Unstake', 'Delegate']);
    });

    it('switches the action from the toggle, with the hint, fields and action button following', async () => {
        mountForm({ initialMode: 'stake' }, namedContract());
        const stakeOn = await screen.findByRole('group', { name: 'Stake On' });
        expect(screen.getByRole('radio', { name: 'Stake' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('radio', { name: 'Unstake' }));
        expect(screen.getByRole('radio', { name: 'Unstake' })).toHaveAttribute('aria-checked', 'true');
        expect(stakeOn).toHaveAccessibleDescription('Free to use in about 2 days (288 blocks)');
        expect(screen.getByRole('button', { name: 'Unstaking' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Unstake' })).toHaveLength(1);

        fireEvent.click(screen.getByRole('radio', { name: 'Delegate' }));
        expect(screen.getByRole('group', { name: 'Stake On' }))
            .toHaveAccessibleDescription('Unstaking takes about 2 days (288 blocks)');
        expect(screen.getByLabelText('New Signing Key')).toBeInTheDocument();
        expect(screen.queryByLabelText(/^Amount/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Delegate Key' })).toBeInTheDocument();
        // The page title follows the Action field.
        expect(screen.getByRole('heading', { name: 'Delegate' })).toBeInTheDocument();
    });

    it('has no penalty destination field', async () => {
        mountForm({ initialMode: 'stake' }, namedContract());
        await screen.findByRole('group', { name: 'Stake On' });
        expect(screen.queryByText('Penalty destination')).toBeNull();
        expect(screen.queryByText('(configured at deploy)')).toBeNull();
        expect(screen.queryByText('bcrt1qslashdestinationexampleexampleexample')).toBeNull();
    });
});
