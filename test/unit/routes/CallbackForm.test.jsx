// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    CallbackForm,
    callbackTermsError,
} from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'btc-0',
    address: 'bc1qdevmockabcd',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const TERMS = Object.freeze({
    tick: 'CALLABLE',
    creator: SOURCE.address,
    callbackTick: 'PAY',
    callbackAmount: '1.25',
    callbackBlock: '100',
});

function messagingFor(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            tick === 'CALLABLE' ? { ...TERMS } : { tick: 'PAY', divisibility: 2 }
        )),
        tokenHolderSummary: vi.fn().mockResolvedValue({
            recipientCount: 1,
            totalPayout: '2.5',
            partial: false,
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: { tokens: [{ tick: 'PAY', divisibility: 2, quantity: '1000' }] },
            }],
        }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'aa' }),
        ...overrides,
    };
    return new Proxy(messaging, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(overrides = {}, props = {}) {
    const messaging = messagingFor(overrides);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CallbackForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={CHAIN}
                initialTick="CALLABLE"
                initialFromAddress={SOURCE.address}
                {...props}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function readySubmit() {
    const button = await screen.findByRole('button', { name: 'Execute callback' });
    await waitFor(() => expect(button.disabled).toBe(false));
    return button;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    __clearTokenInfoCache();
});

describe('callback field validation', () => {
    it('distinguishes unread records from readable records with no callback', () => {
        const unreadMessage = "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.";
        expect(callbackTermsError(null, 2)).toBe(unreadMessage);
        expect(callbackTermsError({ tick: 'CALLABLE', loadError: true }, 2)).toBe(unreadMessage);
        expect(callbackTermsError({ tick: 'CALLABLE' }, 2)).toBe(unreadMessage);
        expect(callbackTermsError({ tick: 'CALLABLE', creator: SOURCE.address }, 2)).toBe(
            'This token does not have a complete callback configuration.',
        );
    });

    it('refuses before review when the issuer is unknown', async () => {
        const buildActionPsbtRequest = vi.fn();
        mount({
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS, creator: null } : { tick: 'PAY', divisibility: 2 }
            )),
            buildActionPsbtRequest,
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: 'Execute callback' })).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it.each([
        [{ ...TERMS, callbackTick: '' }, 'complete callback configuration'],
        [{ ...TERMS, callbackTick: 'BAD|TICK' }, 'Callback token can only use'],
        [{ ...TERMS, callbackAmount: '0' }, 'positive number'],
        [{ ...TERMS, callbackAmount: '-1' }, 'positive number'],
        [{ ...TERMS, callbackAmount: '1.234' }, 'at most 2 decimal places'],
        [{ ...TERMS, callbackBlock: '-1' }, 'whole block height'],
        [{ ...TERMS, callbackBlock: '1.5' }, 'whole block height'],
        [{ ...TERMS, callbackBlock: '9007199254740992' }, 'supported range'],
    ])('rejects malformed callback terms %#', (terms, message) => {
        expect(callbackTermsError(terms, 2)).toContain(message);
    });
});

describe('CallbackForm review safety', () => {
    it('names the watcher action and explains the offline signing handoff', async () => {
        mount();

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'Watcher mode: this prepares the transaction for your offline signer. Sign it there, then bring the signed transaction to a wallet that can broadcast it.',
        )).toBeInTheDocument();
    });

    it('keeps the destructive warning off the form', async () => {
        mount();

        await readySubmit();
        expect(screen.queryByText(/Callback recalls everything/i)).toBeNull();
        expect(screen.queryByText(/Every unit of .* returns to your address/i)).toBeNull();
    });

    it('explains a missing callback only in the summary row and blocks submit', async () => {
        const buildActionPsbtRequest = vi.fn();
        mount({
            getTokenInfo: vi.fn().mockResolvedValue({
                tick: 'CALLABLE',
                creator: SOURCE.address,
            }),
            buildActionPsbtRequest,
        });

        const messages = await screen.findAllByText(/no callback configured/i);
        expect(messages).toHaveLength(1);
        expect(messages[0].closest('dd')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Execute callback' })).toBeDisabled();
        expect(screen.queryByText(/nothing to recall/i)).toBeNull();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('stretches both wide summary cells to one row height', () => {
        const css = readFileSync(
            'packages/core/src/shared/routes/CallbackForm.module.css',
            'utf8',
        );
        const wideRules = css.match(/@media \(min-width: 834px\) \{([\s\S]*)\}\s*$/)?.[1] || '';

        expect(wideRules).toMatch(/\.summaryLabel\s*,\s*\.summaryValue\s*\{[^}]*align-self:\s*stretch/s);
    });

    it('keeps the holder help tip inside its dt and paired with the holder value', async () => {
        mount();
        await readySubmit();

        const tip = screen.getByRole('button', { name: 'About the holder payout estimate' });
        const labelCell = tip.closest('dt');
        expect(labelCell).not.toBeNull();
        expect(labelCell).toHaveTextContent('Holders to pay');
        expect(labelCell.nextElementSibling?.tagName).toBe('DD');
        const bubble = screen.getByText(/The holder count and payout are indicative/);
        expect(bubble).toHaveAttribute('hidden');

        fireEvent.click(tip);
        expect(bubble).not.toHaveAttribute('hidden');
        expect(bubble.closest('dt')).toBe(labelCell);
    });

    it('uses the success action style and an icon', async () => {
        mount();
        const submit = await readySubmit();

        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
    });

    it('explains why the From address must own the token', async () => {
        mount();
        await readySubmit();

        const tip = screen.getByRole('button', { name: 'About From (token owner)' });
        fireEvent.click(tip);
        expect(screen.getByText(
            "The token owner's address. Only the owner can run a callback, so this must be the address that owns the token.",
        )).toBeVisible();
    });

    it('uses the payout token divisibility for the displayed payout', async () => {
        const messaging = mount();
        await readySubmit();

        await waitFor(() => expect(messaging.tokenHolderSummary).toHaveBeenCalledWith(expect.objectContaining({
            callbackAmount: '1.25',
            callbackDecimals: 2,
        })));
        for (const [args] of messaging.tokenHolderSummary.mock.calls) {
            expect(args.callbackDecimals).toBe(2);
        }
    });

    // The holder summary floors each holder's payout to the decimals it is
    // given, so asking before the payout token loads shows a short figure.
    function payoutByDecimals() {
        return vi.fn(async ({ callbackDecimals }) => ({
            recipientCount: 2,
            totalPayout: callbackDecimals === 2 ? '2.5' : '2',
            partial: false,
        }));
    }

    it('waits for the payout token before asking for the holder payout', async () => {
        let releasePayout = () => {};
        const payoutRead = new Promise((resolve) => {
            releasePayout = () => resolve({ tick: 'PAY', divisibility: 2 });
        });
        const messaging = mount({
            getTokenInfo: vi.fn(async ({ tick }) => (tick === 'CALLABLE' ? { ...TERMS } : payoutRead)),
            tokenHolderSummary: payoutByDecimals(),
        });
        await readySubmit();
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(messaging.tokenHolderSummary).not.toHaveBeenCalled();
        expect(screen.queryByText('2 PAY')).toBeNull();

        releasePayout();
        expect(await screen.findByText('2.5 PAY')).toBeTruthy();
        for (const [args] of messaging.tokenHolderSummary.mock.calls) {
            expect(args.callbackDecimals).toBe(2);
        }
    });

    it('shows no payout figure when the payout token read fails', async () => {
        const messaging = mount({
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS } : { tick: 'PAY', divisibility: null, loadError: true }
            )),
            tokenHolderSummary: payoutByDecimals(),
        });
        await readySubmit();
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PAY' })));
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(messaging.tokenHolderSummary).not.toHaveBeenCalled();
        expect(screen.queryByText('Total payout')).toBeNull();
        expect(screen.queryByText('2 PAY')).toBeNull();
    });

    it('shows a plain error for a malformed source before review', async () => {
        const badSource = { ...SOURCE, address: 'not-an-address' };
        const messaging = mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [badSource] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: badSource.id } }),
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS, creator: badSource.address } : { tick: 'PAY', divisibility: 2 }
            )),
        }, { initialFromAddress: badSource.address });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText('The selected source address is not valid for this network.')).toBeTruthy();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });

    it('refuses an invalid custom fee instead of silently using the default', async () => {
        const messaging = mount();
        const submit = await readySubmit();
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '0' } });

        fireEvent.click(submit);

        expect(await screen.findAllByText(/custom fee rate.*greater than zero/i)).not.toHaveLength(0);
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });

    it('refreshes height and refuses review while the callback is still locked', async () => {
        const height = vi.fn()
            .mockResolvedValueOnce({ watermark: 120 })
            .mockResolvedValue({ watermark: 99 });
        const messaging = mount({ getIndexerWatermark: height });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'Callback is not allowed until block 100. The network is at 99.',
        )).toBeTruthy();
        expect(height).toHaveBeenCalledTimes(2);
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses callback terms that changed after the form loaded', async () => {
        let callbackReads = 0;
        const getTokenInfo = vi.fn(async ({ tick }) => {
            if (tick === 'PAY') return { tick: 'PAY', divisibility: 2 };
            callbackReads += 1;
            return callbackReads === 1
                ? { ...TERMS }
                : { ...TERMS, callbackAmount: '2' };
        });
        const messaging = mount({ getTokenInfo });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(/Callback terms changed since this form opened/)).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('names an unread token record when its Review refresh rejects', async () => {
        let callbackReads = 0;
        const getTokenInfo = vi.fn(async ({ tick }) => {
            if (tick === 'PAY') return { tick: 'PAY', divisibility: 2 };
            callbackReads += 1;
            if (callbackReads === 1) return { ...TERMS };
            throw new Error('explorer failed');
        });
        const messaging = mount({ getTokenInfo });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        )).toBeTruthy();
        expect(screen.queryByText(/does not have a complete callback configuration/)).toBeNull();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a payout above the freshly loaded payout-token balance', async () => {
        const messaging = mount({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: SOURCE.address,
                    balances: { tokens: [{ tick: 'PAY', divisibility: 2, quantity: '100' }] },
                }],
            }),
        });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'This address holds only 1 PAY. The current callback payout is 2.5 PAY.',
        )).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('shows the exact wire memo on review and keeps it after Back', async () => {
        mount();
        const memo = await screen.findByLabelText('Memo');
        fireEvent.change(memo, { target: { value: '  final note  ' } });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText('final note')).toBeTruthy();
        expect(screen.getByText('CALLABLE')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByLabelText('Memo')).toHaveValue('  final note  ');
    });

    it('turns refresh failures into plain user-facing copy', async () => {
        const getIndexerWatermark = vi.fn()
            .mockResolvedValueOnce({ watermark: 120 })
            .mockRejectedValue(new Error('rpc exploded'));
        const messaging = mount({ getIndexerWatermark });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'Could not refresh callback terms, block height, and payout. Try again.',
        )).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('CallbackForm with an unread token record', () => {
    // An explorer outage returns a record with no fields. The callback terms
    // are then unknown, not absent: the form states the one issuer refusal and
    // never tells the owner to set up a callback the token may already have.
    it('states the outage once and never reads it as a missing callback', async () => {
        const buildActionPsbtRequest = vi.fn();
        mount({
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { tick: 'CALLABLE', loadError: true } : { tick: 'PAY', divisibility: 2 }
            )),
            buildActionPsbtRequest,
        });

        expect(await screen.findByText(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        )).toBeTruthy();
        expect(screen.queryByText(/has no callback configured/)).toBeNull();
        expect(screen.queryByText(/No callback configured/)).toBeNull();
        expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'Execute callback' })).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});

describe('CallbackForm opened without a token context', () => {
    const LITECOIN = 'litecoin-mainnet';
    const LITE_SOURCE = Object.freeze({
        ...SOURCE,
        id: 'ltc-0',
        address: 'ltc1qdevmockabcd',
        derivationPath: "m/84'/2'/0'/0/0",
    });

    function unlockedMessaging() {
        return {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [SOURCE],
                [LITECOIN]: [LITE_SOURCE],
            }),
            getActiveAddresses: vi.fn().mockResolvedValue({
                [CHAIN]: { id: SOURCE.id },
                [LITECOIN]: { id: LITE_SOURCE.id },
            }),
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: SOURCE.address,
                    balances: {
                        native: { tick: 'BTC', divisibility: 8, quantity: '100000000' },
                        tokens: [{ tick: 'CALLABLE', divisibility: 0, quantity: '1' }],
                    },
                }],
                [LITECOIN]: [{
                    address: LITE_SOURCE.address,
                    balances: {
                        native: { tick: 'LTC', divisibility: 8, quantity: '100000000' },
                        tokens: [],
                    },
                }],
            }),
        };
    }

    it('starts Network, From, Token and refreshes callback data for the picked token', async () => {
        const messaging = mount(unlockedMessaging(), {
            initialChainId: undefined,
            initialTick: undefined,
            initialFromAddress: undefined,
        });

        const network = await screen.findByRole('button', { name: /^Network: Bitcoin/ });
        const from = await screen.findByLabelText('From (token owner)');
        const token = screen.getByRole('button', { name: 'Token: Select a token' });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from.compareDocumentPosition(token) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        fireEvent.click(token);
        fireEvent.click(await screen.findByLabelText(/^Select CALLABLE\b/i));

        expect(await screen.findByRole('button', { name: /^Token: CALLABLE on Bitcoin/ })).toBeTruthy();
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            tick: 'CALLABLE',
        })));
        await waitFor(() => expect(messaging.tokenHolderSummary).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN,
            tick: 'CALLABLE',
        })));
    });

    it('clears a picked token when Network changes to another chain', async () => {
        mount(unlockedMessaging(), {
            initialChainId: undefined,
            initialTick: undefined,
            initialFromAddress: undefined,
        });

        fireEvent.click(await screen.findByRole('button', { name: 'Token: Select a token' }));
        fireEvent.click(await screen.findByLabelText(/^Select CALLABLE\b/i));
        await screen.findByRole('button', { name: /^Token: CALLABLE on Bitcoin/ });

        fireEvent.click(screen.getByRole('button', { name: /^Network: Bitcoin/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select Litecoin/ }));

        expect(await screen.findByRole('button', { name: 'Token: Select a token' })).toBeTruthy();
        expect(await screen.findByLabelText('From (token owner)')).toHaveValue(LITE_SOURCE.address);
    });
});
