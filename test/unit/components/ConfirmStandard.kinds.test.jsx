// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Confirm Standard (G127, revised 2026-11-16: round 5 layout 1, Centred 64
// One Card) for every action kind confirmStandardModel maps: the status notice
// first (green only on the indexer's own approval), one hero icon, the address
// once, one facts card holding the network, the signing wallet and every fee
// row, no Total block, the short warning after the details, and Reject and
// Approve docked, disabled only while a pre-flight finding blocks.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ActionWarningsCard, ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import confirmStyles from '../../../packages/core/src/shared/components/ConfirmStandard.module.css';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import {
    CONFIRM_KINDS,
    confirmHeadline,
    confirmKindFor,
    confirmStatus,
    confirmWarning,
    feeFacts,
    lockChips,
    plainSentence,
    withAddressFact,
    withNetworkFact,
} from '../../../packages/core/src/shared/utils/confirmStandardModel.js';

afterEach(cleanup);

const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const FROM = 'bc1q9h6tq79k0ufd7g5dq5yqh6pu6xkcnvcp4kz2rl';
const CHAIN = 'bitcoin-mainnet';
const PASS = { verdict: 'pass', findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }], unverified: [] };
// The dev shell's mock: the approval code with no dryrun source and no data.
const DEV_MOCK = { verdict: 'pass', findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'client', message: 'Dev mock: no on-chain dry-run' }], unverified: [] };
const FAIL = { verdict: 'fail', findings: [{ code: 'INSUFFICIENT_BALANCE', severity: 'error', overridable: false, message: 'You hold 200 XYZ and this order needs 250 XYZ.' }], unverified: [] };
const PARTIAL = { verdict: 'pass', findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: { subCommandCount: 3, accepted: 2 } }], unverified: [] };
const WARN = { verdict: 'warn', findings: [{ code: 'LOW_BALANCE', severity: 'warning', message: 'Balance is low after this.' }], unverified: [] };
// The SDK's mint declaration verbatim (xchain-sdk src/preflight/checks/mint.js).
const SETTLE_ONLY = { check: 'MINT_ADDRESS_HEADROOM', reason: 'per-address minted headroom, allow/block lists, and mint-guard outcome are server-side only' };

// One composed action per kind: the action name and the decoder's own
// summary and details, the shapes xchain-sdk's describe() returns.
const KINDS = {
    send: ['SEND', `Send 1250 XCHAIN on Bitcoin to ${ADDR}`, [['Token', 'XCHAIN'], ['Amount', '1250'], ['Destination', ADDR]]],
    multiSend: ['SEND', 'Send 30 XCHAIN on Bitcoin to 2 recipients', [['Recipient 1', `10 XCHAIN to ${ADDR}`], ['Recipient 2', `20 XCHAIN to ${FROM}`]]],
    sweep: ['SWEEP', `Sweep balances, ownerships on Bitcoin to ${ADDR}`, [['Destination', ADDR], ['Sweeps', 'balances, ownerships']]],
    issue: ['ISSUE', 'Create token ABC with max supply 21000000 on Bitcoin', [['Token', 'ABC'], ['Max supply', '21000000'], ['Decimals', '8'], ['Initial mint', '21000000'], ['Locking', 'description, supply']]],
    tokenSettings: ['ISSUE', 'Configure token ABC on Bitcoin', [['Token', 'ABC'], ['Decimals', '8'], ['Locking', 'description']]],
    mint: ['MINT', 'Mint 500 ABC on Bitcoin', [['Token', 'ABC'], ['Amount', '500']]],
    destroy: ['DESTROY', 'Destroy 5 ABC on Bitcoin', [['Token', 'ABC'], ['Amount', '5']]],
    order: ['ORDER', 'Create order on Bitcoin: give 250 XYZ for 1000 ABC', [['Give', '250 XYZ'], ['Get', '1000 ABC'], ['Expiration', '1800000000']]],
    orderChange: ['ORDER', 'Cancel order on Bitcoin (#12)', [['Order action index', '12']]],
    orderPayment: ['COINPAY', 'Pay native coin to settle order match #4 on Bitcoin', [['Order match', '4']]],
    dispenser: ['DISPENSER', 'Open dispenser on Bitcoin', [['Token (give)', 'ABC'], ['Per-fill amount', '10'], ['Escrow (locked)', '1000']]],
    airdrop: ['AIRDROP', 'Airdrop 100 ABC on Bitcoin to list #7', [['Token', 'ABC'], ['Per-recipient amount', '100'], ['List action index', '7']]],
    dividend: ['DIVIDEND', 'Pay 0.1 XYZ per unit of ABC on Bitcoin', [['Holders of', 'ABC'], ['Receive', 'XYZ'], ['Per-unit amount', '0.1']]],
    listCreate: ['LIST', 'Create address list "Friends" of 3 addresses on Bitcoin', [['Type', 'address'], ['Name', 'Friends'], ['Items', '3']]],
    listTransfer: ['LIST', `Transfer list #42 to ${ADDR}`, [['List action index', '42'], ['Destination', ADDR]]],
    listShare: ['LIST', 'Share list #42 on every chain', [['List action index', '42']]],
    stake: ['STAKE', 'Stake 100 XCHAIN on Bitcoin to contract #3', [['Amount', '100'], ['Token', 'XCHAIN'], ['Target contract', '3']]],
    vote: ['VOTE', 'Cast ballot "yes" on poll #9 on Bitcoin', [['Poll', '9'], ['Ballot', 'yes']]],
    contractCall: ['EXECUTE', 'Call transfer() on contract #5 on Bitcoin', [['Contract', '5'], ['Method', 'transfer'], ['Arguments', '[]']]],
    contractDeploy: ['DEPLOY', 'Deploy smart contract on Bitcoin', [['Code hash', 'abc123'], ['Gas limit', '100000']]],
    message: ['MESSAGE', `Send an encrypted message on Bitcoin to ${ADDR}`, [['To', ADDR], ['Encryption method', 'ecies']]],
    broadcast: ['BROADCAST', 'Broadcast a message on Bitcoin', [['Message', 'hello']]],
    file: ['FILE', 'Publish file whitepaper.pdf on Bitcoin', [['Name', 'whitepaper.pdf'], ['Type', 'application/pdf']]],
    link: ['LINK', 'Link two actions on Bitcoin', [['Chain 1', 'Bitcoin'], ['Action 1', '1'], ['Chain 2', 'Litecoin'], ['Action 2', '2']]],
    addressLock: ['SLEEP', 'Lock address until block 900000 on Bitcoin', [['Resume block', '900000']]],
    addressSettings: ['ADDRESS', 'Set address options on Bitcoin', [['Fee preference', 'XCHAIN']]],
    price: ['PRICE', 'Publish oracle price 1 BTC = 95000 USD on Bitcoin', [['Coin', 'BTC'], ['Currency', 'USD'], ['Value', '95000']]],
    bet: ['BET', 'Buy 10 of outcome 1 in market 4 on Bitcoin', [['Market', '4'], ['Outcome', '1'], ['Stake', '10']]],
    bridge: ['XBRIDGE', 'Move 10 ABC from Bitcoin to Litecoin', [['Token', 'ABC'], ['Amount', '10'], ['Destination chain', 'Litecoin'], ['Credit to', ADDR]]],
    batch: ['BATCH', 'Batch of 2 actions on Bitcoin:\n1. Mint 1 ABC\n2. Mint 2 ABC', [['Step 1', 'Mint 1 ABC'], ['Step 2', 'Mint 2 ABC']]],
    other: ['FUTURE_THING', 'Do a future thing on Bitcoin', [['Widget', 'blue']]],
};

function decodedFor(kind) {
    const [, summary, details] = KINDS[kind];
    return { summary, details: details.map(([label, value]) => ({ label, value })), warnings: [] };
}

// The decode of a multi-send whose composed legs are exactly these recipients.
function decodedLegs(recipients) {
    return {
        summary: `Send to ${recipients.length} recipients`,
        details: recipients.map((row, index) => ({
            label: `Recipient ${index + 1}`,
            value: `${row.amount} ${row.tick} to ${row.to}`,
        })),
        warnings: [],
    };
}

function props(kind, overrides = {}) {
    const [action] = KINDS[kind];
    return {
        phase: 'ready',
        composed: { chainId: CHAIN, action, networkFeeSats: 1410, xchainFee: '0.5' },
        report: PASS,
        reportLoading: false,
        acknowledged: new Set(),
        onAcknowledge: () => {},
        canApprove: true,
        onApprove: () => {},
        onReject: () => {},
        decoded: decodedFor(kind),
        chainLabel: 'Bitcoin',
        credentials: null,
        credentialsReady: true,
        variant: 'action',
        nativeTicker: 'BTC',
        sourceAddress: FROM,
        networkFee: { amount: '0.0000141', ticker: 'BTC', fiat: null, estimate: false },
        summary: kind === 'multiSend'
            ? { verb: 'Send', direction: 'out', chainId: CHAIN, address: FROM, recipients: [{ to: ADDR, tick: 'XCHAIN', amount: '10' }, { to: FROM, tick: 'XCHAIN', amount: '20' }], totals: ['30 XCHAIN'] }
            : null,
        ...overrides,
    };
}

const FEE_LABELS = ['Network fee', 'Protocol fee', 'Oracle usage fee', 'Automatic donation'];

function count(text, needle) {
    return text.split(needle).length - 1;
}

// How many times an address is shown: an AddressText cut in the middle keeps
// the whole value as its title, so each outermost element titled with it is
// one showing, plus any whole copy left in the remaining text.
function shownCount(container, address) {
    const clone = container.cloneNode(true);
    let shown = 0;
    for (const el of clone.querySelectorAll('[title]')) {
        if (el.getAttribute('title') !== address || !clone.contains(el)) continue;
        if (el.parentElement?.closest(`[title="${address}"]`)) continue;
        shown += 1;
        el.remove();
    }
    return shown + count(clone.textContent, address);
}

function expectStandard(container) {
    const text = container.textContent;
    const modal = container.querySelector('[data-testid="confirm-modal"]');
    expect(container.querySelectorAll('[data-testid="confirm-modal"]')).toHaveLength(1);
    // One hero icon. The only additional marks are the required multi-send
    // asset icons, one for each asset summary row.
    expect(modal.querySelectorAll('[data-testid="confirm-icon"]')).toHaveLength(1);
    const hero = modal.querySelector('[data-testid="confirm-icon"]');
    const nonHeroMarks = [...modal.querySelectorAll('img, [data-xc-avatar]')].filter((el) => !hero.contains(el));
    expect(nonHeroMarks.every((el) => el.closest('[data-testid="confirm-asset-icon"]'))).toBe(true);
    expect(modal.querySelectorAll('[data-testid="confirm-asset-icon"]')).toHaveLength(
        modal.querySelectorAll('[data-testid="confirm-asset-summary"]').length,
    );
    // A single-send address appears once. Multi-send destinations never render;
    // its facts are bounded by asset count instead.
    expect(shownCount(container, ADDR)).toBeLessThanOrEqual(1);
    expect(shownCount(container, FROM)).toBeLessThanOrEqual(1);
    // No Total block: each fee is one row in the facts card.
    expect(container.querySelector('[data-testid^="confirm-total"]')).toBeNull();
    expect(text).not.toMatch(/Includes about|^Total/);
    for (const label of FEE_LABELS) expect(count(text, label)).toBeLessThanOrEqual(1);
    const feeRows = [...container.querySelectorAll('[data-testid^="confirm-fee-"]')];
    expect(new Set(feeRows.map((row) => row.getAttribute('data-testid'))).size).toBe(feeRows.length);
    for (const row of feeRows) expect(row.closest('[data-testid="confirm-facts"]')).not.toBeNull();
    expect(text).not.toMatch(/unavailable/i);
    expect(container.querySelector('details')).toBeNull();
    expect(text).not.toContain('Dev mock');
    expect(text).not.toContain('Looks good');
    expect(text).not.toContain('Checked against');
    // The status notice, when there is one, is the first thing on the page.
    const status = modal.querySelector('[data-testid="confirm-status-slot"]');
    if (status) expect(modal.firstElementChild).toBe(status);
    const buttons = container.querySelectorAll('[data-testid="confirm-buttons"] > button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].getAttribute('data-testid')).toBe('confirm-reject');
    expect(buttons[1].getAttribute('data-testid')).toBe('confirm-approve');
    // A ready confirmation with no blocking finding keeps Approve enabled.
    expect(buttons[1].disabled).toBe(false);
}

function sameWidthClass(container) {
    const [reject, approve] = container.querySelectorAll('[data-testid="confirm-buttons"] > button');
    const widthClass = (el) => [...el.classList].filter((c) => /button/i.test(c) && !/^_?btn/i.test(c));
    expect(widthClass(reject).length).toBeGreaterThan(0);
    expect(widthClass(reject)).toEqual(widthClass(approve));
}

describe('Confirm Standard, every mapped kind', () => {
    it('maps every fixture to its own kind', () => {
        for (const kind of Object.keys(KINDS)) {
            const [action] = KINDS[kind];
            const summary = kind === 'multiSend' ? props(kind).summary : null;
            expect(confirmKindFor({ actionName: action, decoded: decodedFor(kind), summary })).toBe(kind);
            expect(CONFIRM_KINDS[kind]).toBeTruthy();
            expect(CONFIRM_KINDS[kind].feesOnly).toBeUndefined();
        }
        expect(confirmKindFor({ variant: 'message' })).toBe('signMessage');
        expect(confirmKindFor({ variant: 'psbt' })).toBe('signTransaction');
    });

    for (const kind of Object.keys(KINDS)) {
        it(`${kind}: the standard body, green "Checked" first on a real pass, the network as a row`, () => {
            const { container } = render(<ConfirmActionModal {...props(kind)} />);
            expectStandard(container);
            sameWidthClass(container);
            const status = container.querySelector('[data-testid="confirm-status"]');
            expect(status.getAttribute('data-tone')).toBe(kind === 'other' ? 'danger' : 'success');
            expect(status.getAttribute('data-state')).toBe(kind === 'other' ? 'unknownAction' : 'pass');
            expect(status.textContent).toBe(kind === 'other'
                ? "Unknown actionThis wallet can't explain what this action does. Only approve it if you trust where it came from."
                : 'Checked: this will go through.');
            expect(container.querySelector('[data-testid="confirm-sentence"]').textContent.trim()).not.toBe('');
            expect(container.querySelector('[data-testid="confirm-sentence"]').textContent).not.toMatch(/ on Bitcoin/);
            const networks = [...container.querySelectorAll('[data-testid="confirm-facts"] dt')]
                .filter((row) => row.textContent === 'Network');
            expect(networks).toHaveLength(1);
            expect(container.querySelector('[data-testid="confirm-network"]').textContent).toBe('Bitcoin');
        });

        it(`${kind}: the red status shows when the network gave no verdict`, () => {
            const { container } = render(<ConfirmActionModal {...props(kind, { report: DEV_MOCK })} />);
            expectStandard(container);
            const notices = container.querySelectorAll('[data-testid="confirm-status"]');
            expect(notices).toHaveLength(1);
            expect(notices[0].getAttribute('data-tone')).toBe('danger');
            expect(notices[0].getAttribute('data-state')).toBe(kind === 'other' ? 'unknownAction' : 'notChecked');
        });
    }

    it('shows a send recipient exactly once as the first fact, and the spender exactly once', () => {
        const { container, getByTestId } = render(<ConfirmActionModal {...props('send')} />);
        expect(shownCount(container, ADDR)).toBe(1);
        expect(shownCount(container, FROM)).toBe(1);
        const facts = getByTestId('confirm-facts');
        const address = getByTestId('confirm-address');
        expect(address.getAttribute('title')).toBe(ADDR);
        expect(facts.querySelector('dt').textContent).toBe('To');
        expect(facts.querySelector('dd')).toBe(address);
        expect(getByTestId('confirm-source').getAttribute('title')).toBe(FROM);
    });

    it('summarizes one asset across 75 recipients in one icon row', () => {
        const recipients = Array.from({ length: 75 }, (_, index) => ({
            to: `recipient-${index}`,
            tick: 'PEPE',
            amount: '40',
        }));
        const summary = {
            ...props('multiSend').summary,
            ticker: 'PEPE',
            recipients,
            totals: ['3000 PEPE'],
        };
        const { container, getByTestId } = render(<ConfirmActionModal {...props('multiSend', { summary, decoded: decodedLegs(recipients) })} />);
        expect(getByTestId('confirm-sentence').textContent).toBe('Send 3,000 PEPE to 75 recipients');
        const rows = container.querySelectorAll('[data-testid="confirm-asset-summary"]');
        expect(rows).toHaveLength(1);
        expect(rows[0].previousElementSibling.querySelector('[data-testid="confirm-asset-label"]').textContent).toBe('PEPE');
        expect(rows[0].previousElementSibling.querySelector('[role="img"]')).not.toBeNull();
        expect(rows[0].textContent).toBe('3,000 to 75 recipients');
        expect(container.querySelector('[data-testid="confirm-address"]')).toBeNull();
        expect(container.textContent).not.toContain('recipient-0');
    });

    it('summarizes three mixed assets in first-appearance order with distinct recipient counts', () => {
        const recipients = [
            { to: ADDR, tick: 'PEPE', amount: '5' },
            { to: FROM, tick: 'DANK', amount: '25' },
            { to: ADDR, tick: 'PEPE', amount: '10' },
            { to: ADDR, tick: 'DANK', amount: '50' },
            { to: 'bc1qthird', tick: 'WOW', amount: '9' },
            { to: FROM, tick: 'PEPE', amount: '37' },
        ];
        const summary = {
            ...props('multiSend').summary,
            recipients,
            totals: ['52 PEPE', '75 DANK', '9 WOW'],
        };
        const { container, getByTestId } = render(<ConfirmActionModal {...props('multiSend', { summary, decoded: decodedLegs(recipients) })} />);
        expect(getByTestId('confirm-sentence').textContent).toBe('Send 3 assets to 6 recipients');
        const rows = [...container.querySelectorAll('[data-testid="confirm-asset-summary"]')];
        expect(rows.map((row) => row.previousElementSibling.querySelector('[data-testid="confirm-asset-label"]').textContent))
            .toEqual(['PEPE', 'DANK', 'WOW']);
        expect(rows.map((row) => row.textContent)).toEqual([
            '52 to 2 recipients',
            '75 to 2 recipients',
            '9 to 1 recipient',
        ]);
    });

    it('renders 1,000 recipients in O(assets) summary rows and no destination rows', () => {
        const recipients = Array.from({ length: 1000 }, (_, index) => ({
            to: `recipient-${index}`,
            tick: index % 2 === 0 ? 'PEPE' : 'DANK',
            amount: '1',
        }));
        const summary = {
            ...props('multiSend').summary,
            recipients,
            totals: ['500 PEPE', '500 DANK'],
        };
        const { container, getByTestId } = render(<ConfirmActionModal {...props('multiSend', { summary, decoded: decodedLegs(recipients) })} />);
        expect(getByTestId('confirm-sentence').textContent).toBe('Send 2 assets to 1,000 recipients');
        expect(container.querySelectorAll('[data-testid="confirm-asset-summary"]')).toHaveLength(2);
        expect(container.querySelectorAll('[data-testid="confirm-recipient"]')).toHaveLength(0);
        expect([...container.querySelectorAll('dt')].some((row) => /^Recipient \d+$/.test(row.textContent))).toBe(false);
        expect(container.textContent).not.toContain('recipient-999');
    });

    it('sums divisible and indivisible asset amounts exactly without floats', () => {
        const recipients = [
            { to: ADDR, tick: 'PEPE', amount: '9007199254740993' },
            { to: ADDR, tick: 'PEPE', amount: '7' },
            { to: ADDR, tick: 'DANK', amount: '.1' },
            { to: FROM, tick: 'DANK', amount: '.2' },
        ];
        const summary = {
            ...props('multiSend').summary,
            recipients,
            totals: ['9007199254741000 PEPE', '0.3 DANK'],
        };
        const { container } = render(<ConfirmActionModal {...props('multiSend', { summary, decoded: decodedLegs(recipients) })} />);
        const rows = [...container.querySelectorAll('[data-testid="confirm-asset-summary"]')];
        expect(rows.map((row) => row.textContent)).toEqual([
            '9,007,199,254,741,000 to 1 recipient',
            '0.3 to 2 recipients',
        ]);
    });

    it('draws a multi-send from the legs the host decoded when the form holds others', () => {
        const form = props('multiSend').summary;
        const composedLegs = [
            { to: ADDR, tick: 'PEPE', amount: '5' },
            { to: FROM, tick: 'PEPE', amount: '7' },
            { to: 'bc1qthird', tick: 'DANK', amount: '2' },
        ];
        const { container, getByTestId } = render(<ConfirmActionModal {...props('multiSend', {
            summary: form, decoded: decodedLegs(composedLegs),
        })} />);
        expect(getByTestId('confirm-sentence').textContent).toBe('Send 2 assets to 3 recipients');
        const rows = [...container.querySelectorAll('[data-testid="confirm-asset-summary"]')];
        expect(rows.map((row) => row.textContent)).toEqual(['12 to 2 recipients', '2 to 1 recipient']);
        expect([...container.querySelectorAll('dt')].some((row) => /^Recipient \d+$/.test(row.textContent))).toBe(false);
        expect(container.textContent).not.toContain('bc1qthird');
        expect(container.textContent).not.toContain('30 XCHAIN');
    });

    it('keeps the per-asset rows alone when the form and the decode name the same legs', () => {
        const recipients = [{ to: ADDR, tick: 'PEPE', amount: '5' }, { to: FROM, tick: 'PEPE', amount: '7' }];
        const { container } = render(<ConfirmActionModal {...props('multiSend', {
            summary: { ...props('multiSend').summary, recipients, totals: ['12 PEPE'] },
            decoded: decodedLegs(recipients),
        })} />);
        expect(container.querySelectorAll('[data-testid="confirm-asset-summary"]')).toHaveLength(1);
        expect(container.textContent).not.toContain('Recipient 1');
    });

    it('signs a message with the same body and no status claim either way', () => {
        const { container } = render(<ConfirmActionModal {...props('send', {
            variant: 'message', decoded: null, report: null, composed: null, messageText: 'hello world', networkFee: null,
        })} />);
        expectStandard(container);
        expect(container.querySelector('[data-testid="confirm-sentence"]').textContent).toBe('Sign this message');
        expect(container.querySelector('[data-testid="confirm-message-text"]').textContent).toBe('hello world');
        expect(container.querySelector('[data-testid="confirm-status"]')).toBeNull();
        expect(container.querySelector('[data-testid="confirm-warning"]')).toBeNull();
    });

    it('signs a caller PSBT with the same body, its panel in the page', () => {
        const { container } = render(<ConfirmActionModal {...props('send', {
            variant: 'psbt', decoded: null, psbtPanel: <div data-testid="psbt-panel">inputs</div>,
        })} />);
        expectStandard(container);
        expect(container.querySelector('[data-testid="confirm-sentence"]').textContent).toBe('Sign this transaction');
        expect(container.querySelector('[data-testid="psbt-panel"]')).not.toBeNull();
    });

    it('leaves a PSBT decode to its own panel and never says Approve waits on a report-only check', () => {
        const { container } = render(<ConfirmActionModal {...props('mint', {
            variant: 'psbt',
            report: FAIL,
            canApprove: true,
            psbtPanel: <div data-testid="psbt-panel">Mint 500 ABC</div>,
        })} />);
        // The decoded rows are the panel's, not repeated in the facts card.
        expect(container.querySelector('[data-testid="confirm-facts"]')?.textContent || '').not.toContain('Token');
        const notice = container.querySelector('[data-testid="confirm-status"]');
        expect(notice.textContent).toContain('The checks found a problem with this action.');
        expect(notice.textContent).not.toContain('You hold 200 XYZ');
        expect(notice.textContent).not.toMatch(/Approve won't|Sign anyway/);
        expect(container.querySelector('[data-testid="confirm-approve"]').disabled).toBe(false);
    });

    it('says the oracle fees a batch owes even on a passing check', () => {
        const report = { ...PASS, findings: [...PASS.findings, { code: 'DRYRUN_ORACLE_FEES_OWED', severity: 'info', source: 'dryrun', message: 'Owes 1500 sats to oracle bc1qoracle.' }] };
        const { getByTestId } = render(<ConfirmActionModal {...props('batch', { report })} />);
        expect(getByTestId('confirm-status').textContent).toContain('oracle usage fees');
        expect(getByTestId('confirm-status').textContent).toContain('Owes 1500 sats');
        expect(getByTestId('confirm-status').getAttribute('data-state')).toBe('oracleFees');
        expect(getByTestId('confirm-status').getAttribute('data-tone')).toBe('danger');
    });

    it('lists a Taproot envelope commit and reveal, each with its own fee', () => {
        const composed = {
            chainId: CHAIN, action: 'FILE', networkFeeSats: 3000, xchainFee: '0.5',
            revealPsbt: 'rr00', envelopeFees: { commitFeeSats: 1200, revealFeeSats: 1800 },
        };
        const { getByTestId } = render(<ConfirmActionModal {...props('file', { composed })} />);
        expect(getByTestId('confirm-envelope-commit').textContent).toMatch(/Commit transaction: .*fee 0\.000012 BTC/);
        expect(getByTestId('confirm-envelope-reveal').textContent).toMatch(/Reveal transaction: .*fee 0\.000018 BTC/);
        expect(getByTestId('confirm-modal').textContent).not.toMatch(/unavailable/i);
    });

    it('keeps the producer words under a warning line in the status notice', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('order', { report: WARN })} />);
        expect(getByTestId('confirm-status').textContent).toContain('Balance is low after this.');
    });

    it('calls an encrypted file neither public nor gated, its name on its own line', () => {
        const decoded = {
            summary: 'Publish file secret.pdf on Bitcoin',
            details: [{ label: 'Name', value: 'secret.pdf' }, { label: 'Encryption', value: 'aes' }],
            warnings: [],
        };
        const { getByTestId } = render(<ConfirmActionModal {...props('file', { decoded })} />);
        expect(getByTestId('confirm-name').textContent).toBe('secret.pdf');
        expect(getByTestId('confirm-sentence').textContent).toBe('Publish file');
    });

    it('always names the network as a row, after the action rows and before the fees', () => {
        expect(withNetworkFact({
            facts: [{ key: 'network-raw', label: 'Network', value: 'bitcoin-mainnet' }],
            chainName: 'Bitcoin',
        })).toEqual([{ key: 'network', label: 'Network', value: 'Bitcoin', testId: 'confirm-network' }]);
        expect(withNetworkFact({
            facts: [{ key: 'memo', label: 'Memo', value: 'hello' }, { key: 'fee-network', label: 'Network fee', value: '1 BTC' }],
            chainName: 'Bitcoin',
        }).map((fact) => fact.key)).toEqual(['memo', 'network', 'fee-network']);
    });

    it('builds the primary address as the first fact with a From or To label', () => {
        const other = [{ key: 'memo', label: 'Memo', value: 'hello' }];
        expect(withAddressFact({ facts: other, address: ADDR }).map((fact) => fact.label))
            .toEqual(['To', 'Memo']);
        expect(withAddressFact({ facts: other, address: FROM, addressIsSource: true })[0])
            .toMatchObject({ label: 'From', value: FROM, address: true, testId: 'confirm-source' });
        expect(withAddressFact({ facts: [
            ...other,
            { key: 'caller-address', label: 'Address', value: ADDR, address: true, testId: 'confirm-address' },
        ] }).map((fact) => fact.key)).toEqual(['caller-address', 'memo']);
    });

    it('names the signing wallet in plain text, the hero the only icon', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('send', { signingWallet: { id: 'w1', name: 'Main Wallet' } })} />);
        const row = getByTestId('confirm-signing-wallet');
        expect(row.textContent).toBe('Main Wallet');
        expect(row.querySelector('img, svg, [data-xc-avatar]')).toBeNull();
    });

    it('shows the token the action is about as the hero: an order shows what it buys', () => {
        expect(confirmHeadline({ actionName: 'ORDER', decoded: decodedFor('order') }).heroTick).toBe('ABC');
        expect(confirmHeadline({ actionName: 'SEND', decoded: decodedFor('send') }).heroTick).toBe('XCHAIN');
        expect(confirmHeadline({ actionName: 'LIST', decoded: decodedFor('listShare') }).heroTick).toBe('');
        const { getByTestId } = render(<ConfirmActionModal {...props('order')} />);
        expect(getByTestId('confirm-icon').getAttribute('aria-hidden')).toBeNull();
        expect(getByTestId('confirm-icon').textContent).not.toContain('XYZ');
    });

    it('shows a token\'s locks as chips inside the facts card', () => {
        expect(lockChips('max supply, description')).toEqual(['Max supply locked', 'Description locked']);
        const { getByTestId, getAllByTestId } = render(<ConfirmActionModal {...props('issue')} />);
        const chips = getAllByTestId('confirm-lock-chip').map((chip) => chip.textContent);
        expect(chips).toEqual(['Description locked', 'Supply locked']);
        expect(getByTestId('confirm-locks').closest('[data-testid="confirm-facts"]')).not.toBeNull();
    });
});

describe('Confirm Standard, a long user-chosen name on its own line', () => {
    it('puts a list\'s name above a short fixed sentence for create, transfer and share', () => {
        const create = confirmHeadline({ actionName: 'LIST', decoded: decodedFor('listCreate'), chainName: 'Bitcoin' });
        expect(create.name).toBe('Friends');
        expect(create.sentence).toBe('Create address list of 3 addresses');
        const share = confirmHeadline({ actionName: 'LIST', decoded: decodedFor('listShare'), summary: { kind: 'listShare', listName: 'Verified Market Makers Across Every Chain' } });
        expect(share.name).toBe('Verified Market Makers Across Every Chain');
        expect(share.sentence).toBe('Share list on every chain');
    });

    it('puts a contract\'s name above its sentence when the form knows it', () => {
        const head = confirmHeadline({ actionName: 'EXECUTE', decoded: decodedFor('contractCall'), summary: { contractName: 'Rewards Vault' }, chainName: 'Bitcoin' });
        expect(head.name).toBe('Rewards Vault');
        expect(head.sentence).toBe('Call transfer() on contract #5');
    });

    it('never repeats the name as a fact row', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('listCreate')} />);
        expect(getByTestId('confirm-name').textContent).toBe('Friends');
        expect(getByTestId('confirm-modal').textContent.split('Friends').length - 1).toBe(1);
    });
});

describe('Confirm Standard, list transfer', () => {
    const transferSummary = (extra = {}) => ({
        kind: 'listTransfer',
        verb: 'Transfer List',
        target: 'List #908124001',
        listIndex: '908124001',
        direction: 'none',
        chainId: CHAIN,
        address: FROM,
        recipient: ADDR,
        protocolFee: { amount: '0', ticker: 'XCHAIN' },
        facts: [{ label: 'List', value: 'Top Holders' }, { label: 'Members', value: '340' }],
        listName: 'Top Holders',
        ...extra,
    });

    it('puts the list name on its own line over "Transfer list to the new owner" and the new owner, never the From address', () => {
        const { container, getByTestId, queryByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            decoded: null,
            composed: { chainId: CHAIN, action: 'LIST', actionWarnings: ['LIST_TRANSFER'], protocolFeeKnownFree: true },
            networkFee: { amount: '0.000015', ticker: 'BTC', estimate: true },
            summary: transferSummary(),
        })} />);
        const name = getByTestId('confirm-name');
        const sentence = getByTestId('confirm-sentence');
        const address = getByTestId('confirm-address');
        const facts = getByTestId('confirm-facts');
        expect(name.textContent).toBe('Top Holders');
        expect(sentence.textContent).toBe('Transfer list to the new owner');
        expect(name.nextElementSibling).toBe(sentence);
        expect(sentence.nextElementSibling).toBe(facts);
        expect(facts.querySelector('dt').textContent).toBe('New owner');
        expect(facts.querySelector('dd')).toBe(address);
        expect(address.getAttribute('title')).toBe(ADDR);
        expect(shownCount(container, ADDR)).toBe(1);
        expect(shownCount(container, FROM)).toBe(0);
        expect(queryByTestId('confirm-source')).toBeNull();
        expect(container.textContent).not.toContain('908124001');
        const labels = [...getByTestId('confirm-facts').querySelectorAll('dt')].map((dt) => dt.textContent);
        expect(labels).toEqual(['New owner', 'Members', 'Network', 'Network fee (estimate)']);
        // The fee is a row; there is no Total, and the known-free protocol fee
        // is never named as unknown.
        expect(getByTestId('confirm-fee-network').textContent).toBe('0.000015 BTC');
        expect(container.querySelector('[data-testid^="confirm-total"]')).toBeNull();
        expect(container.textContent).not.toMatch(/protocol fee/i);
    });

    it('names the protocol fee as not known when the transfer quote gave no free answer', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            decoded: null,
            composed: { chainId: CHAIN, action: 'LIST', actionWarnings: ['LIST_TRANSFER'] },
            networkFee: { amount: '0.000015', ticker: 'BTC', estimate: true },
            summary: transferSummary(),
        })} />);
        expect(getByTestId('confirm-fee-protocol').textContent).toBe('Not known yet');
    });

    it('says "this list" without a name and never repeats List or shows the id as a name', () => {
        const { getByTestId, queryByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            summary: transferSummary({ listName: '', facts: [{ label: 'List', value: '#908124001' }] }),
        })} />);
        const sentence = getByTestId('confirm-sentence').textContent;
        expect(sentence).toBe('Transfer this list to the new owner');
        expect(sentence).not.toMatch(/List List|\d/);
        expect(queryByTestId('confirm-name')).toBeNull();
        expect(getByTestId('confirm-modal').textContent.split('908124001').length - 1).toBe(1);
    });

    it('takes the id from the decode as the one fact when the form names nothing', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('listTransfer')} />);
        expect(getByTestId('confirm-sentence').textContent).toBe('Transfer this list to the new owner');
        expect(getByTestId('confirm-facts').textContent).toContain('#42');
        expect(getByTestId('confirm-modal').textContent.split('42').length - 1).toBe(1);
        expect(getByTestId('confirm-address').previousElementSibling.textContent).toBe('New owner');
    });

    it('shows no address rather than the signer under New owner when the recipient is unknown', () => {
        const { queryByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            decoded: null,
            summary: transferSummary({ recipient: undefined }),
        })} />);
        expect(queryByTestId('confirm-address')).toBeNull();
        expect(queryByTestId('confirm-source')).toBeNull();
    });

    it('still shows a composed destination that differs from the form\'s new owner', () => {
        const other = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
        const { container, getByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            summary: transferSummary({ recipient: other }),
        })} />);
        expect(getByTestId('confirm-address').getAttribute('title')).toBe(other);
        expect(shownCount(container, ADDR)).toBe(1);
        expect(getByTestId('confirm-facts').textContent).toContain('Destination');
    });

    it('keeps "You can\'t undo this" as the short warning under a failed check', () => {
        const composed = { chainId: CHAIN, action: 'LIST', networkFeeSats: 1410, actionWarnings: ['LIST_TRANSFER'] };
        const { getByTestId } = render(<ConfirmActionModal {...props('listTransfer', { composed, report: FAIL, canApprove: false })} />);
        expect(getByTestId('confirm-status').textContent.startsWith('This will fail')).toBe(true);
        const warning = getByTestId('confirm-warning');
        expect(warning.textContent.startsWith("You can't undo this")).toBe(true);
        const points = [...warning.querySelectorAll('[data-testid="confirm-warning-point"]')].map((p) => p.textContent);
        expect(points).toEqual(['The new owner controls this list from this block on.']);
    });

    it('titles the watcher review card with the kind title', () => {
        const { getByTestId } = render(<ActionWarningsCard ids={['MARKET_CANCEL']} />);
        const card = getByTestId('confirm-action-warnings');
        expect(card.textContent).toContain("You can't undo this");
        expect(card.textContent).toContain('Every open position is refunded in full and the market ends.');
    });
});

describe('Confirm Standard status notice and short warning', () => {
    it('renders two blocking findings as two bullets and disables Approve without the removed sentence', () => {
        const report = {
            verdict: 'fail',
            findings: [
                { code: 'FUTURE_ERROR_A', severity: 'error', overridable: false, message: 'First SDK diagnostic.' },
                { code: 'FUTURE_ERROR_B', severity: 'error', overridable: false, message: 'Second SDK diagnostic.' },
            ],
            unverified: [],
        };
        const { container, getByTestId } = render(<ConfirmActionModal {...props('order', { report, canApprove: false })} />);
        const notice = getByTestId('confirm-status');
        expect(notice.getAttribute('role')).toBe('alert');
        expect(notice.textContent).toContain('This will fail');
        const bullets = [...notice.querySelectorAll('[data-notice-list] > li')];
        expect(bullets).toHaveLength(2);
        expect(bullets.map((bullet) => bullet.textContent)).toEqual([
            'The checks found a problem with this action.',
            'The checks found a problem with this action.',
        ]);
        expect(bullets.every((bullet) => bullet.textContent.length < 60)).toBe(true);
        expect(bullets.every((bullet) => /^[^.!?]+[.!?]$/.test(bullet.textContent))).toBe(true);
        expect(bullets.every((bullet) => bullet.querySelector(`.${confirmStyles.pointDetail}`) === null)).toBe(true);
        expect(notice.textContent).not.toContain('SDK diagnostic');
        expect(notice.textContent).not.toContain("Approve won't send this while it fails.");
        expect(container.querySelector('[data-testid="confirm-modal"]').firstElementChild)
            .toBe(getByTestId('confirm-status-slot'));
        expect(getByTestId('confirm-approve')).toBeDisabled();
        expect(getByTestId('confirm-approve')).toHaveClass(buttonStyles.btn, confirmStyles.disabled);
    });

    it('all-overridable findings keep Sign anyway and release Approve only after every acknowledgement', () => {
        const report = {
            verdict: 'fail',
            findings: [
                { code: 'DRYRUN_INVALID', severity: 'error', overridable: true, message: 'network says no' },
                { code: 'DRYRUN_SECOND', severity: 'error', overridable: true, message: 'network also says no' },
            ],
            unverified: [],
        };
        const toggled = [];
        const base = props('order', { report, canApprove: false, onAcknowledge: (k) => toggled.push(k) });
        const { getAllByRole, getByTestId, rerender } = render(<ConfirmActionModal {...base} />);
        expect(getAllByRole('checkbox', { name: 'Sign anyway' })).toHaveLength(2);
        expect(getByTestId('confirm-approve').disabled).toBe(true);
        const box = getByTestId('confirm-status').querySelector('[data-testid="ack-DRYRUN_INVALID"] input, input[data-testid="ack-DRYRUN_INVALID"]')
            || getByTestId('ack-DRYRUN_INVALID');
        fireEvent.click(box);
        expect(toggled).toEqual(['DRYRUN_INVALID']);
        rerender(<ConfirmActionModal
            {...base}
            acknowledged={new Set(['DRYRUN_INVALID', 'DRYRUN_SECOND'])}
            canApprove
        />);
        expect(getByTestId('confirm-approve').disabled).toBe(false);
    });

    it('hides Sign anyway when any error finding is not overridable', () => {
        const report = {
            verdict: 'fail',
            findings: [
                { code: 'DRYRUN_INVALID', severity: 'error', overridable: true, message: 'network says no' },
                { code: 'HARD_FAILURE', severity: 'error', overridable: false, message: 'hard stop' },
            ],
            unverified: [],
        };
        const { queryByRole, getByTestId } = render(<ConfirmActionModal {...props('order', { report, canApprove: false })} />);
        expect(queryByRole('checkbox', { name: 'Sign anyway' })).toBeNull();
        expect(getByTestId('confirm-approve').disabled).toBe(true);
    });

    it('leaves Approve enabled when the report has no findings', () => {
        const report = { verdict: 'pass', findings: [], unverified: [] };
        const { getByTestId } = render(<ConfirmActionModal {...props('order', { report, canApprove: true })} />);
        expect(getByTestId('confirm-approve').disabled).toBe(false);
    });

    it('an approved mint whose only gap is checked at settlement shows one blue note', () => {
        const report = { ...PASS, unverified: [SETTLE_ONLY] };
        const { getAllByTestId } = render(<ConfirmActionModal {...props('mint', { report })} />);
        const notices = getAllByTestId('confirm-status');
        expect(notices).toHaveLength(1);
        expect(notices[0].getAttribute('data-state')).toBe('settleChecks');
        expect(notices[0].getAttribute('data-tone')).toBe('info');
        expect(notices[0].getAttribute('role')).not.toBe('alert');
        expect(notices[0].textContent).toContain('Checked When It Settles');
        expect(notices[0].textContent).toContain("Some of this token's limits are checked when it settles.");
        expect(notices[0].textContent).not.toContain('Only partly checked');
        // Never the full approval's green claim.
        expect(notices[0].textContent).not.toContain('this will go through');
    });

    it('a settle-time gap beside any other cause keeps the red partly checked status', () => {
        const reports = [
            { ...PASS, unverified: [SETTLE_ONLY, { check: 'BALANCE_LOOKUP', reason: 'timeout' }] },
            { ...PARTIAL, unverified: [SETTLE_ONLY] },
            { ...PASS, restricted: true, unverified: [SETTLE_ONLY] },
            { ...PASS, unverified: [SETTLE_ONLY], findings: [...PASS.findings, { code: 'DRYRUN_SUBCOMMAND_UNJUDGED', severity: 'info', source: 'dryrun', message: 'unjudged', data: { commandIndex: 1 } }] },
        ];
        for (const report of reports) {
            const status = confirmStatus({ report });
            expect(status.state).toBe('partial');
            expect(status.tone).toBe('danger');
            expect(status.title).toBe('Only partly checked');
        }
    });

    it('owed oracle fees keep a settle-time-only report red', () => {
        const report = { ...PASS, unverified: [SETTLE_ONLY], findings: [...PASS.findings, { code: 'DRYRUN_ORACLE_FEES_OWED', severity: 'info', source: 'dryrun', message: 'owes 1 XCHAIN', data: {} }] };
        const status = confirmStatus({ report });
        expect(status.tone).toBe('danger');
        expect(status.state).toBe('partial');
        expect(status.points.map((p) => p.key)).toContain('oracle-owed');
    });

    it('keeps each failure as one short sentence without its SDK detail', () => {
        const findings = ['first internal diagnostic', 'second internal diagnostic'].map((message) => ({
            code: 'FUTURE_ERROR', severity: 'error', source: 'client', message, data: {},
        }));
        const status = confirmStatus({ report: { ...PASS, verdict: 'fail', findings } });
        const failures = status.points.filter((point) => point.key.startsWith('fail-'));
        expect(failures).toHaveLength(2);
        expect(failures.every((point) => point.detail == null)).toBe(true);
        expect(failures.every((point) => point.text === 'The checks found a problem with this action.')).toBe(true);
        expect(failures.every((point) => point.text.length < 60)).toBe(true);
    });

    it('a partly checked batch and a warning verdict each show one red status', () => {
        for (const [report, state] of [[PARTIAL, 'partial'], [WARN, 'warn']]) {
            const { getAllByTestId, unmount } = render(<ConfirmActionModal {...props('batch', { report })} />);
            const notices = getAllByTestId('confirm-status');
            expect(notices).toHaveLength(1);
            expect(notices[0].getAttribute('data-state')).toBe(state);
            expect(notices[0].getAttribute('data-tone')).toBe('danger');
            unmount();
        }
    });

    it('an irreversible action without a verdict: the red status first, the short warning after the details', () => {
        const composed = { chainId: CHAIN, action: 'LIST', networkFeeSats: 1410, actionWarnings: ['LIST_TRANSFER'] };
        const { getByTestId } = render(<ConfirmActionModal {...props('listTransfer', { composed, report: null })} />);
        expect(getByTestId('confirm-status').textContent).toBe('Not checked with the network, so it may still fail.');
        const warning = getByTestId('confirm-warning');
        expect(warning.getAttribute('data-state')).toBe('irreversible');
        expect(warning.getAttribute('role')).toBeNull();
        const facts = getByTestId('confirm-facts');
        expect(facts.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const points = [...warning.querySelectorAll('[data-testid="confirm-warning-point"]')].map((p) => p.textContent);
        expect(points).toEqual(['The new owner controls this list from this block on.']);
    });

    it('docks only Reject and Approve: the warning scrolls with the details', () => {
        const composed = { chainId: CHAIN, action: 'LIST', networkFeeSats: 1410, actionWarnings: ['LIST_TRANSFER'] };
        const { getByTestId, queryByTestId } = render(<ConfirmActionModal {...props('listTransfer', { composed, report: null })} />);
        const decision = getByTestId('confirm-decision');
        expect(decision.closest('footer')).toBeTruthy();
        expect(decision.closest('main')).toBeNull();
        expect([...decision.children]).toEqual([getByTestId('confirm-buttons')]);
        expect(getByTestId('confirm-warning').closest('main')).toBeTruthy();
        expect(queryByTestId('confirm-warning-dock')).toBeNull();
    });

    it('shows the checking line while the check runs, and no status on a bare coin payment', () => {
        const loading = render(<ConfirmActionModal {...props('send', { report: null, reportLoading: true, phase: 'preflighting' })} />);
        expect(loading.getByTestId('confirm-status').getAttribute('data-state')).toBe('checking');
        expect(loading.getByTestId('confirm-checking')).toBeTruthy();
        expect(loading.queryByTestId('confirm-warning')).toBeNull();
        loading.unmount();
        const bare = render(<ConfirmActionModal {...props('send', { report: null, composed: { chainId: CHAIN, action: 'SEND', networkFeeSats: 1410, bareNativePayment: true } })} />);
        expect(bare.queryByTestId('confirm-status')).toBeNull();
        expect(bare.queryByTestId('confirm-warning')).toBeNull();
    });

    it('confirmStatus is green only on a full indexer approval; confirmWarning says only the irreversible and caller lines', () => {
        expect(confirmStatus({ report: PASS }).tone).toBe('success');
        expect(confirmStatus({ report: null }).state).toBe('notChecked');
        expect(confirmStatus({ report: DEV_MOCK }).tone).toBe('danger');
        expect(confirmStatus({ report: PASS, applies: false })).toBeNull();
        expect(confirmStatus({ report: null, loading: true }).state).toBe('checking');
        expect(confirmWarning({})).toBeNull();
        expect(confirmWarning({ actionWarningIds: ['DESTROY'] })).toMatchObject({
            title: "You can't undo this",
            points: [{ text: 'Destroyed tokens are burned for good.' }],
            role: null,
        });
        expect(confirmWarning({ extraWarnings: ['A', 'A'] }).points).toHaveLength(1);
    });
});

describe('Confirm Standard Approve gating', () => {
    it('never shows the green status on a PSBT that carries no XChain action', () => {
        // An ordinary payment PSBT has no chain state to check; even a pass
        // report must not claim it "will go through".
        const plain = render(<ConfirmActionModal {...props('send', { variant: 'psbt', decoded: null, report: PASS })} />);
        expect(plain.queryByTestId('confirm-status')).toBeNull();
        expect(plain.container.textContent).not.toContain('Checked: this will go through.');
        plain.unmount();
        // A PSBT that carries an action keeps its report-only status.
        const withAction = render(<ConfirmActionModal {...props('send', { variant: 'psbt', report: PASS })} />);
        expect(withAction.getByTestId('confirm-status').getAttribute('data-state')).toBe('pass');
    });

    it('a tap before the credentials are complete says so at the top and sends nothing', () => {
        const onApprove = vi.fn();
        const onApproveBlocked = vi.fn();
        const base = props('send', { credentialsReady: false, onApprove, onApproveBlocked });
        const { getByTestId, rerender } = render(<ConfirmActionModal {...base} />);
        const approve = getByTestId('confirm-approve');
        expect(approve.disabled).toBe(false);
        fireEvent.click(approve);
        expect(onApprove).not.toHaveBeenCalled();
        expect(onApproveBlocked).toHaveBeenCalledWith('credentials');
        // Without the caller naming it, the step is not guessed to be a password.
        expect(getByTestId('confirm-blocked').textContent).toBe('Finish the step above Approve, then approve.');
        expect(getByTestId('confirm-blocked').getAttribute('role')).toBe('alert');
        rerender(<ConfirmActionModal {...base} credentialsBlockedText="Enter your password to approve." />);
        expect(getByTestId('confirm-blocked').textContent).toBe('Enter your password to approve.');
    });

    it('a refused request keeps Approve in full colour and says why at the top', () => {
        const onApprove = vi.fn();
        const { getByTestId } = render(<ConfirmActionModal {...props('send', { refusal: 'This transaction spends coins the wallet cannot read.', onApprove })} />);
        fireEvent.click(getByTestId('confirm-approve'));
        expect(onApprove).not.toHaveBeenCalled();
        expect(getByTestId('confirm-blocked').textContent).toBe('This transaction spends coins the wallet cannot read.');
    });

    it('a request in flight shows Approve busy and ignores a second tap', () => {
        let finish;
        const onApprove = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
        const { getByTestId } = render(<ConfirmActionModal {...props('send', { onApprove })} />);
        const approve = getByTestId('confirm-approve');
        fireEvent.click(approve);
        fireEvent.click(approve);
        expect(onApprove).toHaveBeenCalledTimes(1);
        expect(approve.getAttribute('aria-busy')).toBe('true');
        finish?.();
    });
});

describe('Confirm Standard fee rows', () => {
    it('gives each fee its own row with its fiat value, and keeps an unknown fee', () => {
        expect(feeFacts([
            { key: 'network', label: 'Network fee', amount: '0.0000184', ticker: 'BTC', fiat: '~$1.75' },
            { key: 'protocol', label: 'Protocol fee', amount: '0.5', ticker: 'XCHAIN', fiat: '$0.10' },
            { key: 'oracle', label: 'Oracle usage fee', amount: '0', ticker: 'BTC' },
            { key: 'donation', label: 'Automatic donation', amount: null, ticker: 'BTC' },
        ])).toEqual([
            { key: 'fee-network', label: 'Network fee', value: '0.0000184 BTC ($1.75)', testId: 'confirm-fee-network' },
            { key: 'fee-protocol', label: 'Protocol fee', value: '0.5 XCHAIN ($0.10)', testId: 'confirm-fee-protocol' },
            { key: 'fee-donation', label: 'Automatic donation', value: 'Not known yet', testId: 'confirm-fee-donation' },
        ]);
        expect(feeFacts([{ key: 'protocol', label: 'Protocol fee', amount: '0.0001', ticker: 'BTC', notRefunded: true }])[0].value)
            .toBe('0.0001 BTC, not refunded if rejected');
    });

    it('passes a form estimate through as the network fee row', () => {
        const { getByTestId } = render(<ConfirmActionModal {...props('listTransfer', {
            composed: { chainId: CHAIN, action: 'LIST' },
            networkFee: { amount: '0.00002', ticker: 'BTC', estimate: true },
        })} />);
        const fee = getByTestId('confirm-fee-network');
        expect(fee.textContent).toBe('0.00002 BTC');
        expect(fee.closest('[data-testid="confirm-facts"]')).not.toBeNull();
    });

    it('never writes Unavailable for an unknown protocol fee', () => {
        const { container, getByTestId } = render(<ConfirmActionModal {...props('airdrop', {
            composed: { chainId: CHAIN, action: 'AIRDROP', networkFeeSats: 1410 },
            report: { ...PASS },
        })} />);
        expect(container.textContent).not.toMatch(/unavailable/i);
        expect(getByTestId('confirm-fee-protocol').textContent).toBe('Not known yet');
    });
});

describe('plainSentence', () => {
    it('drops the chain name and the shown address', () => {
        expect(plainSentence(`Send 5 ABC on Bitcoin to ${ADDR}`, { chainName: 'Bitcoin', address: ADDR })).toBe('Send 5 ABC to');
        expect(plainSentence('Create order on Bitcoin: give 1 A for 2 B', { chainName: 'Bitcoin' })).toBe('Create order: give 1 A for 2 B');
    });
});
