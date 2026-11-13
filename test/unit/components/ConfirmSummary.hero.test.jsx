// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What the confirm screen's top states for a form's summary: the hero names
// the action, its amount or what it works on, and the recipient; the address
// card names the signer once. With no recipient the From row takes the
// address card's slot and is not repeated under Technical details.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { ConfirmHero } from '../../../packages/core/src/shared/components/ConfirmSummary.jsx';
import { orderGiveParts } from '../../../packages/core/src/shared/utils/confirmSummaryParts.js';

afterEach(() => cleanup());

const CHAIN = 'bitcoin-mainnet';
const SIGNER = 'bc1qexampleexampleexampleexampleexampleex';
const RECIPIENT = 'bc1qrecipientrecipientrecipientrecipientq';

function confirmAction(overrides = {}) {
    return {
        phase: 'ready',
        composed: null,
        report: null,
        acknowledged: new Set(),
        acknowledge: () => {},
        canApprove: true,
        approve: () => {},
        reject: () => {},
        error: null,
        source: SIGNER,
        ...overrides,
    };
}

function renderScreen(summary) {
    return render(
        <ActionConfirmScreen
            confirmAction={confirmAction()}
            summary={summary}
            chainLabel="Bitcoin"
            chainId={CHAIN}
            signerReady
            password=""
            onPasswordChange={() => {}}
        />,
    );
}

describe('confirm summary hero', () => {
    it('states the verb, the signed amount and the chain', () => {
        render(<ConfirmHero summary={{ verb: 'Destroy', amount: '5', ticker: 'FOO', chainId: CHAIN, direction: 'out' }} />);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toMatch(/5\s*FOO/);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toContain('−');
        expect(screen.getByTestId('confirm-hero-line').textContent).toMatch(/^Destroy on/);
    });

    it('names the token as the big line when no amount moves', () => {
        render(<ConfirmHero summary={{ verb: 'Lock Token', ticker: 'FOO', chainId: CHAIN, direction: 'none' }} />);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toBe('FOO');
        expect(screen.getByTestId('confirm-hero-line').textContent).toMatch(/^Lock Token on/);
    });

    it('names a non-token target as the big line when no amount moves', () => {
        render(<ConfirmHero summary={{ verb: 'Rename List', target: 'Friends (List #12)', chainId: CHAIN }} />);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toBe('Friends (List #12)');
        expect(screen.queryByTestId('confirm-hero-target')).toBeNull();
    });

    it('puts the target on the line under an amount', () => {
        render(<ConfirmHero summary={{ verb: 'Deposit', amount: '2', ticker: 'FOO', target: 'Contract #7', chainId: CHAIN, direction: 'out' }} />);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toMatch(/2\s*FOO/);
        expect(screen.getByTestId('confirm-hero-target').textContent).toBe('· Contract #7');
    });

    it('keeps the verb as the big line when the chain is unknown', () => {
        render(<ConfirmHero summary={{ verb: 'Lock Token', ticker: 'FOO', chainId: 'no-such-chain' }} />);
        expect(screen.getByTestId('confirm-hero-amount').textContent).toBe('Lock Token');
    });
});

describe('confirm summary text and figures', () => {
    it('cleans hidden and direction controls out of a target and keeps it to one short line', () => {
        const question = `Lower‮fees\nnext ${'year '.repeat(60)}`;
        render(<ConfirmHero summary={{ verb: 'Vote', target: question, chainId: CHAIN }} />);
        const big = screen.getByTestId('confirm-hero-amount').textContent;
        expect(big).not.toMatch(/[‮\n]/);
        expect(big.startsWith('Lower')).toBe(true);
        expect(big.length).toBeLessThanOrEqual(120);
        expect(big.endsWith('…')).toBe(true);
    });

    it('never shows the decoded amount beside a ticker the form states without one', () => {
        render(
            <ActionConfirmScreen
                confirmAction={confirmAction({
                    composed: {
                        chainId: CHAIN,
                        decoded: {
                            summary: 'Dividend 0.5 PAY',
                            details: [{ label: 'Amount', value: '0.5' }, { label: 'Token', value: 'PAY' }],
                            warnings: [],
                        },
                    },
                })}
                summary={{ verb: 'Pay Dividend', ticker: 'PAY', target: 'Holders of FOO', chainId: CHAIN, direction: 'out' }}
                chainLabel="Bitcoin"
                chainId={CHAIN}
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
        );
        // The per-unit rate the host decoded is not the payout, so the big
        // line names what is paid instead of showing 0.5 as the total.
        expect(screen.getByTestId('confirm-hero-amount').textContent).not.toContain('0.5');
    });

    it('keeps the decoded amount when the form states no figure', () => {
        render(
            <ActionConfirmScreen
                confirmAction={confirmAction({
                    composed: {
                        chainId: CHAIN,
                        decoded: {
                            summary: 'Send 3 FOO',
                            details: [{ label: 'Amount', value: '3' }, { label: 'Token', value: 'FOO' }],
                            warnings: [],
                        },
                    },
                })}
                summary={{ verb: 'Send', chainId: CHAIN, address: SIGNER }}
                chainLabel="Bitcoin"
                chainId={CHAIN}
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
        );
        expect(screen.getByTestId('confirm-hero-amount').textContent).toMatch(/3\s*FOO/);
    });
});

describe('orderGiveParts', () => {
    it('states a token given as leaving the signer', () => {
        expect(orderGiveParts({ GIVE_TICK: 'foo', GIVE_AMOUNT: '5', GIVE_COIN: 'BTC' }, 'BTC'))
            .toEqual({ amount: '5', ticker: 'FOO', direction: 'out' });
    });

    it('states a coin given without a sign, so it never joins this transaction cost', () => {
        expect(orderGiveParts({ GIVE_TICK: '', GIVE_AMOUNT: '0.1', GIVE_COIN: 'BTC' }, 'BTC'))
            .toEqual({ amount: '0.1', ticker: 'BTC', direction: 'none' });
    });

    it('states an ownership given as its token with no amount', () => {
        expect(orderGiveParts({ GIVE_TICK: 'foo', GIVE_OWNERSHIP: '1' }, 'BTC'))
            .toEqual({ ticker: 'FOO', direction: 'none' });
    });

    it('states nothing it does not have', () => {
        expect(orderGiveParts({ GIVE_TICK: 'foo' }, 'BTC')).toEqual({ direction: 'none' });
        expect(orderGiveParts(null)).toEqual({ direction: 'none' });
    });
});

describe('confirm summary address and From row', () => {
    it('with no recipient, shows the From row once, in the address card slot', () => {
        renderScreen({ verb: 'Cancel Order', chainId: CHAIN, direction: 'none', address: SIGNER });
        expect(screen.queryByTestId('confirm-address')).toBeNull();
        const rows = screen.getAllByTestId('confirm-source');
        expect(rows).toHaveLength(1);
        expect(within(screen.getByTestId('confirm-technical')).queryByTestId('confirm-source')).toBeNull();
        expect(rows[0].textContent).toContain(SIGNER);
    });

    it('with a recipient, names it on the hero line and still names the signer once', () => {
        renderScreen({
            verb: 'Send', amount: '1', ticker: 'FOO', chainId: CHAIN, direction: 'out', address: SIGNER, recipient: RECIPIENT,
        });
        const line = screen.getByTestId('confirm-hero-line');
        expect(line.textContent).toMatch(/^Send on/);
        expect(line.querySelector(`[title="${RECIPIENT}"]`) || line.textContent.includes(RECIPIENT.slice(0, 8))).toBeTruthy();
        const rows = screen.getAllByTestId('confirm-source');
        expect(rows).toHaveLength(1);
        expect(rows[0].textContent).toContain(SIGNER);
        expect(within(screen.getByTestId('confirm-technical')).queryByTestId('confirm-source')).toBeNull();
    });

    it('with a different address the action happens on, shows it in the address card and the From row under Technical details', () => {
        const other = 'bc1qotherotherotherotherotherotherotherotq';
        renderScreen({ verb: 'Mint', amount: '1', ticker: 'FOO', chainId: CHAIN, direction: 'in', address: other });
        // The card cuts the address in the middle; the whole address is its title.
        const card = screen.getByTestId('confirm-address');
        expect(card.querySelector(`[title="${other}"]`) || card.textContent.includes(other)).toBeTruthy();
        expect(within(screen.getByTestId('confirm-technical')).getAllByTestId('confirm-source')).toHaveLength(1);
        expect(screen.getAllByTestId('confirm-source')).toHaveLength(1);
    });
});
