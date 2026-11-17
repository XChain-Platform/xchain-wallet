// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Action detail page the operator picked on 2026-11-13 (Layout 1 with
// the shared Actions | Details toggle): the mark and signed amount with only
// the address under it, the four-step status bar, then Actions | Details,
// with no Overview or Raw Data view and no status steps or copy buttons in
// Details. Actions comes first and is chosen on arrival (G102); it holds the
// one action list (G101): Speed up while a replaceable send is on its way,
// View dispenser, the explorer links, the receipt, Save as contact and
// Cancel transaction. The page has no header menu.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { actionStatusSteps } from '../../../packages/core/src/shared/routes/ActionDetailView.jsx';
import { detailsPanel, fact, factLabels } from '../../helpers/detailFacts.js';

const CHAIN = 'bitcoin-mainnet';
const OURS = 'bc1qwalletaddress000000000000000000000000001';
const THEIRS = 'bc1qcounterparty00000000000000000000000001';
const TX_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const short = (address) => `${address.slice(0, 6)}…${address.slice(-6)}`;

function confirmedSend(overrides = {}) {
    return {
        key: `${CHAIN}:4812906:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '4812906',
        action: 'SEND',
        blockIndex: 100,
        timestamp: 1705350600,
        txHash: TX_HASH,
        source: OURS,
        raw: {
            source: OURS,
            destination: THEIRS,
            amount: '0.0125',
            tick: 'BTC',
            fee: '0.0000142',
            memo: 'November rent',
        },
        link: null,
        detailContext: { chainTip: 113, indexerWatermark: 113, walletAddresses: [OURS] },
        ...overrides,
    };
}

function pendingSend(overrides = {}) {
    return confirmedSend({
        key: `pending:${CHAIN}:${TX_HASH}`,
        actionIndex: '',
        blockIndex: 0,
        timestamp: Date.now() - 240000,
        rbf: true,
        pending: {
            origin: 'local',
            rbf: true,
            firstSeenMs: Date.now() - 240000,
            observedAtMs: Date.now() - 240000,
            broadcastAtMs: Date.now() - 240000,
            lastMempoolSeenMs: Date.now() - 30000,
            direction: 'out',
            destinations: [THEIRS],
            localStatus: null,
            pendingTxId: 'p1',
            replaced: false,
            replacementTxHash: null,
        },
        ...overrides,
    });
}

function messagingFor(overrides = {}) {
    return {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode: 'full' }]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
        replaceTx: vi.fn().mockResolvedValue({
            originalFee: '0.0000142', replacementFee: '0.0000284', feeIncrease: '0.0000142',
        }),
        ...overrides,
    };
}

function renderPage(entry, messaging = messagingFor()) {
    const view = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ActionDetail entry={entry} walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
    return { view, messaging };
}

/** Each status step as assistive tech reads it (the dot's glyph is hidden). */
function statusSteps() {
    const bar = screen.getByRole('list', { name: 'Transaction Status' });
    return within(bar).getAllByRole('listitem').map((li) => {
        const copy = li.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
        return copy.textContent;
    });
}

/** The Actions view's action list, the view the page opens on. */
function actionList() {
    return screen.getByRole('list', { name: 'Actions for this transaction' });
}

/** Each row's title, the text before its description. */
function actionTitles() {
    return within(actionList()).getAllByRole('listitem').map((item) => (
        item.querySelector('[class*="titleText"]').textContent
    ));
}

/** A row of the action list by the title its accessible name starts with. */
function actionRow(title) {
    return within(actionList()).getByRole(/^View on/.test(title) ? 'link' : 'button', { name: new RegExp(`^${title}`) });
}

function queryActionRow(title) {
    return within(actionList()).queryByRole('button', { name: new RegExp(`^${title}`) });
}

/** [label, value] per row; a label's help tip text is not part of the label. */
function rowsOf(panel) {
    return factLabels(panel).map((label) => [label, fact(label, panel).textContent]);
}

function openDetails() {
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    return detailsPanel();
}

afterEach(() => { cleanup(); });

describe('Action detail hero', () => {
    it('shows the signed amount and only the recipient address under it on a send', () => {
        const { view } = renderPage(confirmedSend());
        expect(screen.getByTestId('action-hero-amount')).toHaveTextContent(/^-0\.0125 BTC$/);
        const line = screen.getByTestId('action-hero-address');
        expect(line.textContent).toBe(`Sent to ${short(THEIRS)}`);
        // No fiat price, no Confirmed / Verified / time pills on the hero.
        const hero = line.closest('section');
        expect(hero.textContent).not.toMatch(/[$≈]|Confirmed|Verified|ago/);
        expect(view.container.querySelector('[data-testid="confirm-hero"]')).toBeNull();
    });

    it('shows the sender address on a receive', () => {
        renderPage(confirmedSend({
            source: THEIRS,
            raw: { source: THEIRS, destination: OURS, amount: '3.25', tick: 'BTC' },
        }));
        expect(screen.getByTestId('action-hero-amount')).toHaveTextContent(/^\+3\.25 BTC$/);
        expect(screen.getByTestId('action-hero-address').textContent).toBe(`Received from ${short(THEIRS)}`);
    });

    it('names a protocol action with no amount and shows its source address', () => {
        renderPage(confirmedSend({
            action: 'DISPENSER',
            raw: { source: OURS, tick: 'DANKEST', give_amount: '100', escrow_quantity: '10000' },
        }));
        expect(screen.getByTestId('action-hero-amount')).toHaveTextContent(/^Dispenser$/);
        expect(screen.getByTestId('action-hero-address').textContent).toBe(`Made from ${short(OURS)}`);
    });
});

describe('Action detail status bar', () => {
    it('shows every step complete on a confirmed and processed action', () => {
        renderPage(confirmedSend());
        expect(statusSteps()).toEqual([
            'Signed, Complete', 'Broadcast, Complete', 'Confirmed, Complete', 'Processed, Complete',
        ]);
    });

    it('shows Confirmed in progress on a pending send', () => {
        renderPage(pendingSend());
        expect(statusSteps()).toEqual([
            'Signed, Complete', 'Broadcast, Complete', 'Confirmed, In Progress', 'Processed, Not Started',
        ]);
    });

    it('marks a replaced send and a failed send where they stopped', () => {
        const replaced = actionStatusSteps(pendingSend({
            pending: { ...pendingSend().pending, replaced: true, replacementTxHash: 'b'.repeat(64) },
        }));
        expect(replaced.steps.map((s) => [s.label, s.state])).toEqual([
            ['Signed', 'done'], ['Broadcast', 'done'], ['Replaced', 'warn'], ['Processed', 'todo'],
        ]);
        const failed = actionStatusSteps(pendingSend({
            txHash: '',
            pending: { ...pendingSend().pending, failed: true, error: 'insufficient funds' },
        }));
        // It died before it had a hash, so the first step it missed says so.
        expect(failed.steps.map((s) => [s.label, s.state])).toEqual([
            ['Failed', 'error'], ['Broadcast', 'todo'], ['Confirmed', 'todo'], ['Processed', 'todo'],
        ]);
    });
});

describe('Action detail Speed up and Cancel', () => {
    it('puts Speed up first and Cancel transaction last, in red, in the action list of a pending replaceable send', async () => {
        const { view } = renderPage(pendingSend());
        await waitFor(() => expect(queryActionRow('Speed up')).not.toBeNull());
        const titles = actionTitles();
        expect(titles[0]).toBe('Speed up');
        expect(titles[titles.length - 1]).toBe('Cancel transaction');
        expect(actionRow('Speed up').getAttribute('aria-disabled')).toBeNull();
        expect(actionRow('Cancel transaction').getAttribute('data-tone')).toBe('danger');
        expect(actionRow('Speed up').getAttribute('data-tone')).toBe('default');
        expect(view.container.textContent).not.toMatch(/not yet validated|sign a replacement|Pending,/i);
    });

    it('opens the speed-up confirmation in one click', async () => {
        const { messaging } = renderPage(pendingSend());
        await waitFor(() => expect(queryActionRow('Speed up')).not.toBeNull());
        fireEvent.click(actionRow('Speed up'));
        await waitFor(() => expect(messaging.replaceTx).toHaveBeenCalledTimes(1));
        expect(messaging.replaceTx.mock.calls[0][0]).toMatchObject({ preview: true, strategy: 'speedup' });
        expect(await screen.findByText('Speed up this transaction?')).toBeTruthy();
    });

    it('opens the cancel confirmation from Cancel transaction', async () => {
        const { messaging } = renderPage(pendingSend());
        await waitFor(() => expect(queryActionRow('Cancel transaction')).not.toBeNull());
        fireEvent.click(actionRow('Cancel transaction'));
        await waitFor(() => expect(messaging.replaceTx).toHaveBeenCalledTimes(1));
        expect(messaging.replaceTx.mock.calls[0][0]).toMatchObject({ preview: true, strategy: 'cancel' });
    });

    it('offers no Speed up or Cancel transaction on a confirmed action', async () => {
        const { messaging } = renderPage(confirmedSend({ rbf: true }));
        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalled());
        expect(queryActionRow('Speed up')).toBeNull();
        expect(queryActionRow('Cancel transaction')).toBeNull();
    });

    it('keeps Speed Up on a send the network has not reported, where a higher fee is the way out', async () => {
        renderPage(pendingSend({
            pending: {
                ...pendingSend().pending,
                firstSeenMs: null,
                lastMempoolSeenMs: null,
                observedAtMs: null,
                broadcastAtMs: Date.now() - 3_600_000,
            },
        }));
        expect(statusSteps()[2]).toBe('Not Seen, Stopped');
        await waitFor(() => expect(queryActionRow('Speed up')).not.toBeNull());
    });

    it('offers no Speed up on a watch-only wallet', async () => {
        const { messaging } = renderPage(pendingSend(), messagingFor({
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'Wallet', walletMode: 'watcher' }]),
        }));
        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalled());
        expect(queryActionRow('Speed up')).toBeNull();
    });
});

describe('Action detail View dispenser', () => {
    it('opens the dispenser a DISPENSER action created from its action-list row', () => {
        const onOpenDispenser = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={messagingFor()}>
                <ActionDetail
                    entry={confirmedSend({ action: 'DISPENSER', raw: { source: OURS, tick: 'DANKEST' } })}
                    walletId="wallet-1"
                    onBack={() => {}}
                    onOpenDispenser={onOpenDispenser}
                />
            </MessagingProvider>,
        );
        const row = actionRow('View dispenser');
        expect(row.querySelector('svg')).not.toBeNull();
        fireEvent.click(row);
        expect(onOpenDispenser).toHaveBeenCalledWith(CHAIN, '4812906');
    });

    it('offers no View dispenser on a plain send', () => {
        renderPage(confirmedSend());
        expect(queryActionRow('View dispenser')).toBeNull();
    });
});

describe('Action detail Actions list', () => {
    it('holds the explorer link, the receipt and Save as contact, each with an icon and a description', async () => {
        renderPage(confirmedSend());
        // Save as contact needs the contact list read first.
        await waitFor(() => expect(actionTitles()).toContain('Save as contact'));
        const titles = actionTitles();
        expect(titles[0]).toBe('View on the explorer');
        expect(titles.slice(-3)).toEqual(['Share receipt', 'Copy receipt', 'Save as contact']);
        expect(titles).not.toContain('Cancel transaction');
        const explorer = actionRow('View on the explorer');
        expect(explorer).toHaveAttribute('href', 'https://explorer.xchain.io/BTC/action/4812906');
        expect(explorer).toHaveAttribute('target', '_blank');
        expect(explorer).toHaveAttribute('rel', 'noopener noreferrer');
        for (const item of within(actionList()).getAllByRole('listitem')) {
            expect(item.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
            expect(item.textContent.length).toBeGreaterThan(item.querySelector('[class*="titleText"]').textContent.length);
        }
        // The header carries no menu any more.
        expect(screen.queryByRole('button', { name: 'Transaction Actions' })).toBeNull();
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('copies the receipt from its row', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
        renderPage(confirmedSend());
        fireEvent.click(actionRow('Copy receipt'));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(writeText.mock.calls[0][0]).toContain(TX_HASH);
    });

    it('shares the receipt from its row, copying it where the share sheet is missing', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
        renderPage(confirmedSend());
        fireEvent.click(actionRow('Share receipt'));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        expect(writeText.mock.calls[0][0]).toContain(TX_HASH);
    });

    it('opens a pending action in its own window from Open in new window on desktop', async () => {
        const openDetached = vi.fn().mockResolvedValue({ ok: true });
        globalThis.xchainWalletWindow = { openDetached };
        try {
            render(
                <MessagingProvider shell="desktop" messaging={messagingFor()}>
                    <ActionDetail entry={pendingSend()} walletId="wallet-1" onBack={() => {}} />
                </MessagingProvider>,
            );
            fireEvent.click(actionRow('Open in new window'));
            expect(openDetached).toHaveBeenCalledWith({
                initialView: 'history',
                initialContext: { walletId: 'wallet-1', chainId: CHAIN, actionIndex: '', txHash: TX_HASH },
            });
        } finally {
            delete globalThis.xchainWalletWindow;
        }
    });

    it('opens the save-contact form from Save as contact', async () => {
        renderPage(confirmedSend());
        await waitFor(() => expect(actionTitles()).toContain('Save as contact'));
        fireEvent.click(actionRow('Save as contact'));
        expect(await screen.findByRole('textbox', { name: /Save .* as/ })).toBeTruthy();
    });

    it('offers Remove from history in red on a failed send and dismisses the record', async () => {
        const dismissFailedPendingTx = vi.fn().mockResolvedValue(undefined);
        renderPage(
            pendingSend({ pending: { ...pendingSend().pending, failed: true, error: 'insufficient funds' } }),
            messagingFor({ dismissFailedPendingTx }),
        );
        const row = actionRow('Remove from history');
        expect(row.getAttribute('data-tone')).toBe('danger');
        fireEvent.click(row);
        await waitFor(() => expect(dismissFailedPendingTx).toHaveBeenCalledWith({ pendingTxId: 'p1' }));
    });
});

describe('Action detail Actions | Details', () => {
    it('shows only Actions and Details, Actions first and selected', () => {
        renderPage(confirmedSend());
        const toggle = screen.getByRole('tablist', { name: 'Action View' });
        expect(within(toggle).getAllByRole('tab').map((tab) => [tab.textContent, tab.getAttribute('aria-selected')]))
            .toEqual([['Actions', 'true'], ['Details', 'false']]);
        for (const tab of within(toggle).getAllByRole('tab')) {
            expect(tab.querySelector('svg')).not.toBeNull();
        }
        expect(screen.queryByRole('tab', { name: /Overview|Raw/i })).toBeNull();
        expect(within(screen.getByRole('tabpanel', { name: 'Actions' })).getByRole('list', { name: 'Actions for this transaction' })).toBeTruthy();
    });

    it('opens Details on the basic facts, then every other fact, each once', () => {
        renderPage(confirmedSend());
        const details = openDetails();
        const rows = rowsOf(details);
        const labels = rows.map(([label]) => label);
        // The old Overview facts lead, in their order, with their help tips.
        expect(labels.slice(0, 6)).toEqual(['Amount', 'Network fee', 'Total', 'From', 'To', 'Memo']);
        expect(rows[0][1]).toBe('-0.0125 BTC');
        expect(rows[1][1]).toBe('0.0000142 BTC');
        expect(rows[2][1]).toBe('0.0125142 BTC');
        expect(rows[5][1]).toBe('November rent');
        expect(within(details).getAllByRole('button', { name: /More info/ })).toHaveLength(2);
        for (const label of ['Action number', 'Transaction ID', 'Block', 'Confirmations', 'Time', 'Verification']) {
            expect(labels).toContain(label);
        }
        expect(new Set(labels).size).toBe(labels.length);
        // One facts card: no second status timeline and no copy buttons.
        expect(details.querySelectorAll('dl')).toHaveLength(1);
        expect(within(details).queryByRole('heading', { level: 3 })).toBeNull();
        expect(within(details).queryByRole('list', { name: 'Transaction status' })).toBeNull();
        expect(within(details).queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
    });

    it('lists every output of a pending multi-output send under Details', () => {
        const SECOND = 'bc1qsecondrecipient000000000000000000000001';
        const data = `SEND|1|XCHAIN|25|${THEIRS}|75|${SECOND}|rent split`;
        renderPage(pendingSend({
            raw: { source: OURS },
            pending: { ...pendingSend().pending, origin: 'mempool', data },
        }));
        const details = openDetails();
        const outputs = rowsOf(details).filter(([label]) => /^Output \d$/.test(label));
        expect(outputs).toEqual([
            ['Output 1', `25 XCHAIN to ${short(THEIRS)} · rent split`],
            ['Output 2', `75 XCHAIN to ${short(SECOND)} · rent split`],
        ]);
        expect(details.querySelector('pre')).toBeNull();
    });

    it('shows a pending non-SEND action by name', () => {
        const data = 'ISSUE|0|NEWCOIN|1000|0|0|0|0|0|0';
        renderPage(pendingSend({
            action: 'ISSUE',
            raw: { source: OURS },
            pending: { ...pendingSend().pending, origin: 'mempool', data },
        }));
        expect(screen.getByTestId('action-hero-amount')).toHaveTextContent(/^Issue$/);
        expect(queryActionRow('Speed up')).toBeNull();
        expect(fact('Action', openDetails())).toHaveTextContent('Issue');
    });

    it('renders no collapsible section anywhere on the page', () => {
        const { view } = renderPage(pendingSend({
            pending: { ...pendingSend().pending, failed: true, error: 'node said: bad-txns-inputs-missingorspent' },
        }));
        for (const view_ of ['Actions', 'Details']) {
            fireEvent.click(screen.getByRole('tab', { name: view_ }));
            expect(view.container.querySelector('details, summary')).toBeNull();
            expect(screen.queryByRole('button', { name: /Technical Details/i })).toBeNull();
        }
        // The failure reason reads in the open under the bar, and the raw
        // node text sits in Details rather than behind a disclosure.
        expect(fact('Failure details', openDetails()))
            .toHaveTextContent('node said: bad-txns-inputs-missingorspent');
    });
});
