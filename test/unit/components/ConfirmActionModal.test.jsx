// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ConfirmActionModal render + interaction contract (§5.1-5.2).

import { Profiler } from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { Screen as LayoutScreen, ScrollRestoration } from '../../../packages/core/src/ui/Screen.jsx';
import { expectNoSeriousAxeViolations } from '../../a11y/helpers/axe.js';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';

const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

beforeAll(() => {
    registerLocale('de-DE', {});
    registerLocale('fr-FR', {});
    registerLocale('hi-IN', {});
});

afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    await setLocale('en');
});

const DECODED = {
    summary: 'Send 5 JDOG to bc1qxyz',
    details: [
        { label: 'Amount', value: '5' },
        { label: 'Destination', value: 'bc1qxyz' },
    ],
    warnings: [],
};
// The SDK's valid dry-run finding: source 'dryrun' and a data object are what
// make it the indexer's verdict (utils/preflightCheckState.js).
const REPORT_PASS = { verdict: 'pass', restricted: false, findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }], unverified: [], stateHeight: 100 };
const REPORT_HARD_FAIL = { verdict: 'fail', restricted: false, findings: [{ code: 'DEST_ADDRESS_INVALID', severity: 'error', overridable: false, message: 'bad address' }], unverified: [] };
const REPORT_OVERRIDABLE = { verdict: 'fail', restricted: false, findings: [{ code: 'DRYRUN_INVALID', severity: 'error', overridable: true, message: 'network says no' }], unverified: [] };

function base(overrides = {}) {
    return {
        phase: 'ready', composed: { psbt: 'x' }, report: REPORT_PASS, reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(), decoded: DECODED, simulation: null,
        chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />, credentialsReady: true,
        variant: 'action', ...overrides,
    };
}

describe('ConfirmActionModal', () => {

    it('has no serious axe violations in its open state', async () => {
        const { container } = render(<ConfirmActionModal {...base({
            credentials: <label>Password<input type="password" /></label>,
        })} />);

        await expectNoSeriousAxeViolations(container);
    });

    it('renders nothing when phase is idle', () => {
        const { container } = render(<ConfirmActionModal {...base({ phase: 'idle' })} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the Confirm Standard body: sentence, address fact, Reject and Approve, no pass banner', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.getByTestId('confirm-sentence').textContent).toBe('Send 5 JDOG to');
        const address = screen.getByTestId('confirm-address');
        expect(address).toHaveAttribute('title', 'bc1qxyz');
        expect(address.closest('[data-testid="confirm-facts"]')).not.toBeNull();
        expect(address.previousElementSibling).toHaveTextContent('To');
        expect(screen.queryByTestId('preflight-panel')).toBeNull();
        expect(screen.queryByTestId('confirm-warning')).toBeNull();
        expect(screen.getByTestId('confirm-modal').textContent).not.toMatch(/Looks good|Checked against/);
        expect(screen.getByTestId('confirm-approve').textContent).toBe('Approve');
        expect(screen.getByTestId('confirm-reject').textContent).toBe('Reject');
    });

    it.each([411, 1280])('docks only Reject and Approve, 8px between and around them, at %ipx', (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);

        const buttons = screen.getByTestId('confirm-buttons');
        const decision = screen.getByTestId('confirm-decision');
        // The status notice scrolls with the page; the docked footer holds
        // only the two buttons (G127 revised 2026-11-16).
        expect(screen.getByTestId('confirm-status').closest('main')).toBeTruthy();
        expect([...decision.children]).toEqual([buttons]);
        expect(decision.closest('footer')).toBeTruthy();
        expect(decision.closest('main')).toBeNull();

        const css = readFileSync(
            'packages/core/src/shared/components/ConfirmStandard.module.css',
            'utf8',
        );
        expect(css).toMatch(/\.buttons\s*\{[^}]*gap:\s*var\(--xc-space-2\)/s);
        // 8px all round the buttons: the footer that holds them pads
        // space-2 on every side, keeping the home-indicator inset.
        expect(css).toMatch(/footer:has\(\.buttons\)\s*\{[^}]*padding:\s*var\(--xc-space-2\);[^}]*padding-bottom:\s*calc\(var\(--xc-space-2\) \+ var\(--xc-screen-safe-bottom/s);
        expect(css).not.toMatch(/warningDock/);
    });

    it.each([411, 1280])('puts the status notice exactly 8px below the toolbar at %ipx', (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);

        const standardCss = readFileSync('packages/core/src/shared/components/ConfirmStandard.module.css', 'utf8');
        const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
        const tokensCss = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        expect(screen.getByTestId('confirm-modal').firstElementChild)
            .toBe(screen.getByTestId('confirm-status-slot'));
        expect(standardCss).toMatch(/\.stack\s*\{[^}]*gap:\s*var\(--xc-space-2\)/s);
        expect(standardCss).not.toMatch(/\.stack\s*\{[^}]*padding-(?:block-)?top/s);
        expect(screenCss).toMatch(/\.body\s*\{[^}]*padding:\s*var\(--xc-page-top\) var\(--xc-page-gutter\)/s);
        expect(tokensCss).toMatch(/--xc-page-top:\s*var\(--xc-space-2\);\s*\/\* 8px everywhere \*\//);
    });

    it('does not expose the removed technicalDetails adapter prop', () => {
        const source = readFileSync(
            'packages/core/src/shared/components/ActionConfirmScreen.jsx',
            'utf8',
        );
        expect(source).not.toMatch(/\btechnicalDetails\b/);
    });

    it('shows a payment once: the sentence without the chain, the destination as the first fact', () => {
        const destination = 'bcrt1qz0l4ngaddre55thatneed5truncat10n9x7w2';
        const summary = `Send 0.01 BTC on Bitcoin to ${destination}`;
        render(<ConfirmActionModal {...base({
            decoded: {
                summary,
                details: [
                    { label: 'Token', value: 'BTC' },
                    { label: 'Amount', value: '0.01' },
                    { label: 'Destination', value: destination },
                ],
                warnings: [],
            },
        })} />);

        const modal = screen.getByTestId('confirm-modal');
        expect(screen.getByTestId('confirm-sentence').textContent).toBe('Send 0.01 BTC to');
        expect(modal.textContent.split(destination).length - 1).toBeLessThanOrEqual(1);
        const facts = screen.getByTestId('confirm-facts');
        const address = screen.getByTestId('confirm-address');
        expect(address.querySelector('[title]')).toHaveAttribute('title', destination);
        expect(address.closest('[data-testid="confirm-facts"]')).toBe(facts);
        expect(facts.querySelector('dt')).toHaveTextContent('To');
        expect(facts.querySelector('dd')).toBe(address);
    });

    it('shows an order expiration as the moment it names, not as Unix seconds', () => {
        const seconds = '4118400000';
        render(<ConfirmActionModal {...base({
            decoded: {
                summary: 'Create swap on Bitcoin: give 1 AAA for 1 BBB',
                details: [
                    { label: 'Give', value: '1 AAA' },
                    { label: 'Get', value: '1 BBB' },
                    { label: 'Expiration', value: seconds },
                ],
                warnings: [],
            },
        })} />);

        const value = screen.getByText('Expiration').nextElementSibling;
        expect(value.textContent).not.toContain(seconds);
        expect(value.textContent).toMatch(/2100/);
    });

    it('shows the hardware output caveat only for a hardware signer', () => {
        const { rerender } = render(<ConfirmActionModal {...base()} />);
        expect(screen.queryByText(/A hardware device verifies native outputs/i)).toBeNull();

        rerender(<ConfirmActionModal {...base({ hardwareSigner: true })} />);
        expect(screen.getByText(/A hardware device verifies native outputs/i)).toBeTruthy();
    });

    it('uses the bare approve fallback when no decoded action is available', () => {
        render(<ConfirmActionModal {...base({ decoded: null })} />);

        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Review this action');
        expect(screen.getByTestId('confirm-approve')).toHaveTextContent(/^Approve$/);
        expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    });

    it('uses a short warning only when approving a contract call', () => {
        render(<ConfirmActionModal {...base({
            decoded: { summary: 'Call contract #21', details: [], warnings: [] },
        })} />);

        // The warning slot's one danger notice carries it (G127).
        expect(screen.getByTestId('confirm-warning')).toHaveTextContent(
            'Only approve a contract call you understand. Review the contract, method, amounts, and permissions first.',
        );
    });

    it('says every action in one plain sentence and keeps the footer Approve as the reviewed amount changes', () => {
        const { rerender } = render(<ConfirmActionModal {...base({
            decoded: {
                summary: 'Send 0.5 BTC to bc1qxyz',
                details: [
                    { label: 'Token', value: 'BTC' },
                    { label: 'Amount', value: '0.5' },
                ],
                warnings: [],
            },
        })} />);
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/^Send 0\.5 BTC to$/);

        rerender(<ConfirmActionModal {...base({
            decoded: {
                summary: 'Send 12345678901234567890.12345678 BTC to bc1qxyz',
                details: [
                    { label: 'Token', value: 'BTC' },
                    { label: 'Amount', value: '12345678901234567890.12345678' },
                ],
                warnings: [],
            },
        })} />);
        expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent(/^Send 12,345,678,901,234,567,890\.12345678 BTC to$/);

        rerender(<ConfirmActionModal {...base({
            decoded: { summary: 'Create dispenser on Bitcoin: lock 10 TOKEN', details: [], warnings: [] },
        })} />);
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/^Create dispenser: lock 10 TOKEN$/);

        rerender(<ConfirmActionModal {...base({
            decoded: { summary: 'Cancel order on Bitcoin (#17)', details: [], warnings: [] },
        })} />);
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/^Cancel order \(#17\)$/);

        rerender(<ConfirmActionModal {...base({
            decoded: { summary: 'Publish 123.45 to feed 700', details: [], warnings: [] },
        })} />);
        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/^Publish 123\.45 to feed 700$/);
        expect(screen.getByTestId('confirm-approve')).toHaveTextContent(/^Approve$/);
    });

    it('orders the page as status, icon, sentence, facts with the address first and fees, then the short warning', () => {
        const { container } = render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', action: 'SEND', actionWarnings: ['DESTROY'] },
            nativeTicker: 'BTC',
            networkFee: { amount: '0.1', ticker: 'BTC' },
            report: null,
        })} />);
        expect(container.querySelector('[data-testid^="confirm-total"]')).toBeNull();
        const order = ['confirm-status', 'confirm-icon', 'confirm-sentence', 'confirm-facts', 'confirm-warning']
            .map((id) => screen.getByTestId(id));
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        const facts = screen.getByTestId('confirm-facts');
        expect(facts.querySelector('dt')).toHaveTextContent('To');
        expect(facts.querySelector('dd')).toBe(screen.getByTestId('confirm-address'));
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.1 BTC');
        // The address and amount are said by the sentence and first fact, so
        // the decoded Destination and Amount rows do not repeat them.
        expect(container.textContent).not.toContain('Destination');
        expect(screen.getByTestId('confirm-facts').textContent).not.toContain('Amount');
    });

    it('says an order as a trade sentence and keeps Reject red and Approve green', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', action: 'ORDER' },
            decoded: {
                summary: 'Create order: give 5 JDOG for 0.01 BTC',
                details: [
                    { label: 'Get', value: '0.01 BTC' },
                    { label: 'Receive address', value: 'bc1qreceive' },
                    { label: 'Give', value: '5 JDOG' },
                ],
                warnings: [],
            },
        })} />);

        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent('Buy 0.01 BTC for 5 JDOG');
        // The Give and Get rows are the sentence; the receive address stays a fact.
        const labels = Array.from(screen.getByTestId('confirm-facts').querySelectorAll('dt'))
            .map((node) => node.textContent);
        expect(labels).toContain('Receive address');
        expect(labels).not.toContain('You send');
        expect(screen.getByTestId('confirm-reject').className).toContain('danger');
        expect(screen.getByTestId('confirm-approve').className).toContain('success');
        expect(screen.getAllByRole('button').filter((button) => button.className.includes('success')))
            .toHaveLength(1);
    });

    it('keeps a fee whose amount is unknown as its own row, never as Unavailable', () => {
        const confirmAction = {
            phase: 'ready',
            composed: { psbt: 'x', decoded: DECODED },
            report: REPORT_PASS,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };

        render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainId="bitcoin-mainnet"
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );

        expect(screen.getByTestId('confirm-modal').textContent).not.toMatch(/unavailable/i);
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('Not known yet');
        expect(screen.getByTestId('confirm-facts').querySelector('[data-testid="confirm-fee-network"]')).not.toBeNull();
    });

    it('passes the form estimate through once as the network fee row', () => {
        const confirmAction = {
            phase: 'ready',
            composed: { psbt: 'x', action: 'SEND', chainId: 'bitcoin-mainnet', protocolFeeKnownFree: true, decoded: DECODED },
            report: REPORT_PASS,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };
        render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainId="bitcoin-mainnet"
                chainLabel="Bitcoin"
                feeEstimate={{ coinAmount: '0.0002' }}
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );
        const fee = screen.getByTestId('confirm-fee-network');
        expect(fee).toHaveTextContent('0.0002 BTC');
        expect(fee.closest('[data-testid="confirm-facts"]')).not.toBeNull();
        expect(screen.getAllByTestId('confirm-fee-network')).toHaveLength(1);
    });

    it.each([
        ['trailing zeros', '1.25000000', '1.25'],
        ['tiny non-zero amount', '0.000000001', '< 0.00000001'],
        ['exact extended precision', '0.000000010000000001', '0.000000010000000001'],
    ])('uses the shared display policy for %s', (_label, value, expected) => {
        render(<ConfirmActionModal {...base({
            decoded: {
                ...DECODED,
                summary: `Send ${value} JDOG to bc1qxyz`,
                details: DECODED.details.map((detail) => (
                    detail.label === 'Amount' ? { ...detail, value } : detail
                )),
            },
        })} />);
        // The amount is said once, in the sentence, by the shared display policy.
        expect(screen.getByTestId('confirm-sentence').textContent)
            .toBe(`Send ${expected} JDOG to`);
        expect(screen.queryByText('Amount')).toBeNull();
        expect(screen.getByTestId('confirm-approve').textContent).toBe('Approve');
    });

    it.each([
        ['de-DE', '1.234.567,89'],
        ['fr-FR', '1\u202f234\u202f567,89'],
        ['hi-IN', '12,34,567.89'],
    ])('shows the reviewed amount with the same %s separators as entry', async (
        locale,
        expected,
    ) => {
        await setLocale(locale);
        render(<ConfirmActionModal {...base({
            decoded: {
                ...DECODED,
                summary: 'Send 1234567.89 JDOG to bc1qxyz',
                details: DECODED.details.map((detail) => (
                    detail.label === 'Amount' ? { ...detail, value: '1234567.89' } : detail
                )),
            },
        })} />);

        expect(screen.getByTestId('confirm-sentence').textContent).toBe(`Send ${expected} JDOG to`);
        expect(screen.getByTestId('confirm-approve').textContent).toBe('Approve');
    });

    it('shows an exact native payment fee once as its row, with no Total', () => {
        const confirmAction = {
            phase: 'ready',
            composed: {
                chainId: 'bitcoin-mainnet',
                bareNativePayment: true,
                networkFeeSats: 2500,
                decoded: {
                    summary: 'Send 1 BTC to bc1qxyz',
                    details: [
                        { label: 'Token', value: 'BTC' },
                        { label: 'Amount', value: '1' },
                        { label: 'Destination', value: 'bc1qxyz' },
                    ],
                    warnings: [],
                },
            },
            report: null,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };
        const { rerender } = render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect(screen.getByTestId('confirm-sentence').textContent).toBe('Send 1 BTC to');
        expect(screen.getByTestId('confirm-fee-network').textContent).toBe('0.000025 BTC');
        expect(screen.getByTestId('confirm-modal').textContent.match(/0\.000025 BTC/g)).toHaveLength(1);
        // A bare coin payment has nothing for the indexer to check, so the
        // page makes no status claim either way.
        expect(screen.queryByTestId('confirm-status')).toBeNull();

        rerender(
            <ActionConfirmScreen
                confirmAction={{
                    ...confirmAction,
                    composed: {
                        ...confirmAction.composed,
                        decoded: {
                            ...confirmAction.composed.decoded,
                            details: [
                                { label: 'Token', value: 'JDOG' },
                                { label: 'Amount', value: '1' },
                            ],
                        },
                    },
                }}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
            />,
        );
        // A token payment and a coin fee stay in their own units.
        expect(screen.getByTestId('confirm-sentence').textContent).toBe('Send 1 JDOG to');
        expect(screen.getByTestId('confirm-fee-network').textContent).toBe('0.000025 BTC');
    });

    it.each([360, 412])('keeps long Send review values readable and its actions pinned at %ipx', (width) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        const address = 'bc1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
        const longToken = 'A-VERY-LONG-TOKEN-NAME-THAT-MUST-NOT-HIDE-VALUES';
        const amount = '12345678.12345678';
        const fiatValue = '≈ $12,345,678.90 USD';
        const memo = 'First memo line stays readable.\nSecond memo line also stays readable.';
        const summary = `Send ${amount} ${longToken} to ${address}`;
        const displayedSummary = `Send 12,345,678.12345678 ${longToken} to ${address}`;
        const confirmAction = {
            phase: 'ready',
            composed: {
                chainId: 'bitcoin-mainnet',
                networkFeeSats: 2500,
                decoded: {
                    summary,
                    details: [
                        { label: 'Token', value: longToken },
                        { label: 'Amount', value: amount },
                        { label: 'Fiat value', value: fiatValue },
                        { label: 'Destination', value: address },
                    ],
                    warnings: [],
                },
                simulation: {
                    deltas: [{ tick: longToken, before: amount, after: '87654321.87654321' }],
                    notes: [],
                },
            },
            report: REPORT_PASS,
            acknowledged: new Set(),
            acknowledge: vi.fn(),
            canApprove: true,
            approve: vi.fn(),
            reject: vi.fn(),
            error: null,
            source: null,
        };

        render(
            <ActionConfirmScreen
                confirmAction={confirmAction}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={vi.fn()}
                formatNativeFee={() => fiatValue}
                extraCredentials={(
                    <dl aria-label="Advanced send details">
                        <dt>Memo</dt>
                        <dd data-testid="confirm-send-memo">{memo}</dd>
                    </dl>
                )}
            />,
        );

        expect(address).toHaveLength(62);
        // The sentence wraps whole; the address is the first fact row; a
        // long fact is cut to one line with its full value as the title (G121).
        expect(screen.getByTestId('confirm-sentence'))
            .toHaveTextContent(`Send 12,345,678.12345678 ${longToken} to`);
        expect(screen.getByTestId('confirm-address').querySelector('[title]')).toHaveAttribute('title', address);
        expect(screen.getByTestId('confirm-facts').querySelector('dd')).toBe(screen.getByTestId('confirm-address'));
        expect(screen.getByTestId('confirm-sentence').textContent).not.toContain(address);
        expect(screen.getByTitle(fiatValue)).toBeTruthy();
        expect(screen.getByTestId('confirm-send-memo').textContent).toBe(memo);
        expect(screen.getByTestId('confirm-fee-network'))
            .toHaveTextContent('0.000025 BTC');
        const approve = screen.getByTestId('confirm-approve');
        expect(approve).toBeVisible();
        expect(approve).toHaveTextContent(/^Approve$/);
        const reviewMain = screen.getByTestId('confirm-modal').closest('main');
        const actionFooter = approve.closest('footer');
        expect(actionFooter).toBe(reviewMain.nextElementSibling);
        expect(actionFooter).toContainElement(screen.getByTestId('confirm-reject'));
        expect(reviewMain).not.toContainElement(approve);

        const standardCss = readFileSync(
            'packages/core/src/shared/components/ConfirmStandard.module.css',
            'utf8',
        );
        const modalCss = readFileSync(
            'packages/core/src/shared/components/ConfirmActionModal.module.css',
            'utf8',
        );
        expect(standardCss).not.toMatch(/@container|container-type/);
        expect(standardCss).toMatch(/\.sentence\s*\{[^}]*overflow-wrap:\s*anywhere/s);
        expect(standardCss).toMatch(/\.oneLine\s*\{[^}]*text-overflow:\s*ellipsis/s);
        // Reject and Approve stay a row of two halves at every width.
        expect(standardCss).toMatch(/\.buttons\s*\{[^}]*flex-direction:\s*row/s);
        expect(standardCss).toMatch(/\.button\s*\{[^}]*flex:\s*1 1 0/s);
        expect(standardCss).not.toMatch(/@media[^{]*\{[^}]*\.buttons/s);
        expect(modalCss).toMatch(/\.credentials dd\s*\{[^}]*white-space:\s*pre-wrap/s);
        expect(modalCss).toMatch(/@media \(max-width: 480px\)[\s\S]*\.credentials dl\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    });

    it('uses a plain sentence when an action has no decoded summary', () => {
        render(<ConfirmActionModal {...base({ decoded: null })} />);
        expect(screen.getByText('Review this action')).toBeTruthy();
        expect(screen.getByTestId('confirm-modal').getAttribute('aria-label'))
            .toBe('Confirm Review this action');
    });

    it('shows the browser-verified requesting site in a labelled block', () => {
        render(<ConfirmActionModal {...base({
            requestOrigin: 'https://very-long-requesting-site.example/path',
        })} />);
        const site = screen.getByTestId('confirm-request-origin');
        expect(site.tagName).toBe('SECTION');
        expect(site.getAttribute('aria-label')).toBe('Requesting site');
        expect(site.textContent).toContain('https://very-long-requesting-site.example/path');
    });

    it('does not claim a requesting site for a wallet-initiated action', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.queryByTestId('confirm-request-origin')).toBeNull();
    });

    it('shows the hardware verification caveat only for hardware signers', () => {
        const copy = /A hardware device verifies native outputs and destinations only/;
        const { rerender } = render(<ConfirmActionModal {...base()} />);

        expect(screen.queryByText(copy)).toBeNull();

        rerender(<ConfirmActionModal {...base({ hardwareSigner: true })} />);
        expect(screen.getByText(copy)).toBeInTheDocument();

        const adapter = readFileSync(
            'packages/core/src/shared/components/ActionConfirmScreen.jsx',
            'utf8',
        );
        expect(adapter).toMatch(/hardwareSigner=\{Boolean\(hwSource\)\}/);
    });

    // #40. The page that is the last check before signing did not say who was
    // signing, in a wallet that holds several addresses per chain.
    describe('the From row (#40)', () => {
        const ADDR = 'ndDEAAqTMcJmDFEHkLPfEjGvPTyY4NVoTY';

        it('names the spender on the action variant', () => {
            render(<ConfirmActionModal {...base({ sourceAddress: ADDR })} />);
            // A send shows its recipient as the first fact, so the spender is
            // the later From row.
            const row = screen.getByTestId('confirm-source');
            expect(row.previousElementSibling.textContent).toMatch(/^From/);
            // The final review keeps the complete address visible and also
            // exposes it through the title attribute.
            expect(row.querySelector('[title]')?.getAttribute('title')).toBe(ADDR);
            expect(row.getAttribute('title')).toBe(ADDR);
        });

        it('renders no row when no source was supplied', () => {
            render(<ConfirmActionModal {...base()} />);
            expect(screen.queryByTestId('confirm-source')).toBeNull();
        });

        // The restriction is the design, not an oversight: a caller-supplied
        // PSBT can spend several owned addresses, and the psbt variant already
        // enumerates its inputs and marks which ones the wallet owns. One From
        // line there would assert a single spender that may not exist.
        it('stays off the psbt variant even when a source is passed', () => {
            render(<ConfirmActionModal {...base({
                variant: 'psbt', sourceAddress: ADDR, headline: 'Sign transaction',
                psbtPanel: <div data-testid="psbt-panel" />,
            })} />);
            expect(screen.queryByTestId('confirm-source')).toBeNull();
            expect(screen.getByTestId('psbt-panel')).toBeTruthy();
        });
    });

    it('renders no error region by default', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.queryByTestId('confirm-error')).toBeNull();
    });

    it('§5.3.4: surfaces a credential error in-modal (role=alert) while staying at ready', () => {
        // A bad password returns the hook to `ready` with `error` set: the modal
        // must stay open and TELL the user, so they can retype and re-approve
        // the SAME PSBT rather than the modal tearing down.
        render(<ConfirmActionModal {...base({ error: Object.assign(new Error('Incorrect password.'), { name: 'InvalidPasswordError' }) })} />);
        const alert = screen.getByTestId('confirm-error');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toMatch(/Incorrect password/);
        // Still approvable: the user gets to try again.
        expect(screen.getByTestId('confirm-approve').hasAttribute('disabled')).toBe(false);
    });

    it('accepts a plain string error', () => {
        render(<ConfirmActionModal {...base({ error: 'Something broke.' })} />);
        expect(screen.getByTestId('confirm-error').textContent).toMatch(/Something broke/);
    });

    it('replaces internal error identifiers with plain copy', () => {
        render(<ConfirmActionModal {...base({ error: 'SDKEncoderError: INSUFFICIENT_FUNDS' })} />);
        const text = screen.getByTestId('confirm-error').textContent;
        expect(text).toMatch(/wallet service returned no explanation/i);
        expect(text).not.toMatch(/SDKEncoderError|INSUFFICIENT_FUNDS/);
    });

    it('explains when a failed request carries no diagnostic message', () => {
        render(<ConfirmActionModal {...base({ error: {} })} />);
        expect(screen.getByTestId('confirm-error').textContent)
            .toMatch(/wallet service returned no explanation/i);
    });

    // Page form (operator direction 2026-07-22): the confirm surface
    // renders as a full page with a "Confirm" header whose back arrow is
    // Reject, in place of the old overlay modal.
    it('renders as a page titled Confirm (no overlay dialog)', () => {
        render(<ConfirmActionModal {...base()} />);
        // The page is titled Confirm; its footer button reads Approve (ruling G24).
        expect(screen.getByRole('heading', { level: 1, name: 'Confirm' })).toBeTruthy();
        expect(screen.getByTestId('confirm-approve')).toHaveTextContent(/^Approve$/);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it('opens each review at the top with focus on its heading', () => {
        const firstComposed = { psbt: 'first' };
        const { rerender } = render(
            <ScrollRestoration routeKey="send">
                <LayoutScreen><button type="button">Open review</button></LayoutScreen>
            </ScrollRestoration>,
        );
        const composeScroller = screen.getByRole('main');
        composeScroller.scrollTop = 480;
        screen.getByRole('button', { name: 'Open review' }).focus();

        rerender(
            <ScrollRestoration routeKey="send">
                <ConfirmActionModal {...base({ composed: firstComposed })} />
            </ScrollRestoration>,
        );
        const heading = screen.getByRole('heading', { name: 'Confirm' });
        const scroller = screen.getByRole('main');

        expect(scroller.scrollTop).toBe(0);
        expect(heading).toHaveFocus();
        scroller.scrollTop = 480;
        screen.getByTestId('confirm-approve').focus();

        rerender(
            <ScrollRestoration routeKey="send">
                <ConfirmActionModal {...base({ composed: { psbt: 'second' } })} />
            </ScrollRestoration>,
        );

        expect(scroller.scrollTop).toBe(0);
        expect(heading).toHaveFocus();
        expect(screen.getByTestId('confirm-approve')).not.toHaveFocus();
    });

    it('the header back arrow rejects in the ready phase', () => {
        const onReject = vi.fn();
        render(<ConfirmActionModal {...base({ onReject })} />);
        fireEvent.click(screen.getByLabelText('Back to previous screen'));
        expect(onReject).toHaveBeenCalledOnce();
    });

    it('the header back arrow is inert once signing has begun', () => {
        const onReject = vi.fn();
        render(<ConfirmActionModal {...base({ onReject, phase: 'signing' })} />);
        const back = screen.getByLabelText('Back to previous screen');
        expect(back.disabled).toBe(true);
        fireEvent.click(back);
        expect(onReject).not.toHaveBeenCalled();
    });

    it('Reject is disabled during signing (post-signature exit lockout)', () => {
        render(<ConfirmActionModal {...base({ phase: 'signing' })} />);
        expect(screen.getByTestId('confirm-reject').disabled).toBe(true);
    });

    it('shows elapsed signing time and a safe next step after the timeout', () => {
        vi.useFakeTimers();
        render(<ConfirmActionModal {...base({ phase: 'signing' })} />);

        expect(screen.queryByTestId('confirm-signing-elapsed')).toBeNull();
        act(() => vi.advanceTimersByTime(3_000));
        expect(screen.getByTestId('confirm-signing-elapsed')).toHaveTextContent('3 seconds');

        act(() => vi.advanceTimersByTime(57_000));
        expect(screen.getByTestId('confirm-signing-timeout')).toHaveTextContent(/check History/i);
        expect(screen.getByTestId('confirm-reject')).toBeDisabled();
    });

    it('a non-overridable error disables Approve and offers no ack checkbox', () => {
        const onApprove = vi.fn();
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false, onApprove })} />);
        expect(screen.getByTestId('confirm-approve').disabled).toBe(true);
        fireEvent.click(screen.getByTestId('confirm-approve'));
        expect(onApprove).not.toHaveBeenCalled();
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
        expect(screen.queryByTestId('ack-DEST_ADDRESS_INVALID')).toBeNull();
    });

    it('a network-sourced error shows an acknowledgment checkbox', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_OVERRIDABLE, canApprove: false })} />);
        expect(screen.getByTestId('ack-DRYRUN_INVALID')).toBeTruthy();
    });

    it('sends nothing until the preview finishes loading, and says so on a tap', () => {
        const onApprove = vi.fn();
        const props = base({
            phase: 'preflighting', report: null, reportLoading: true, onApprove,
        });
        const { rerender } = render(<ConfirmActionModal {...props} />);

        const button = screen.getByTestId('confirm-approve');
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(onApprove).not.toHaveBeenCalled();
        expect(screen.getByTestId('confirm-blocked')).toHaveTextContent('Wait for the network check to finish, then approve.');

        rerender(<ConfirmActionModal {...props} phase="ready" reportLoading={false} />);
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();
        // The reason it answered no longer holds, so the notice goes.
        expect(screen.queryByTestId('confirm-blocked')).toBeNull();
    });

    it('Approve disables synchronously on click and calls onApprove once', () => {
        const onApprove = vi.fn(() => new Promise(() => {}));
        render(<ConfirmActionModal {...base({ onApprove })} />);
        const btn = screen.getByTestId('confirm-approve');
        fireEvent.click(btn);
        expect(btn.disabled).toBe(true);         // sync-disabled this tick
        fireEvent.click(btn);                     // second click ignored
        expect(onApprove).toHaveBeenCalledOnce();
    });

    it('starts one approval for two clicks dispatched before React re-renders', () => {
        const onApprove = vi.fn(() => new Promise(() => {}));
        render(<ConfirmActionModal {...base({ onApprove })} />);
        const btn = screen.getByTestId('confirm-approve');
        // One act batches both clicks, so the second still sees the first
        // render's enabled state: only the synchronous guard can drop it.
        act(() => {
            btn.click();
            btn.click();
        });
        expect(onApprove).toHaveBeenCalledOnce();
    });

    it('does not carry busy state or focus into a new request', () => {
        const firstComposed = { psbt: 'first' };
        const secondComposed = { psbt: 'second' };
        const firstApprove = vi.fn(() => new Promise(() => {}));
        const secondApprove = vi.fn();
        const { rerender } = render(<ConfirmActionModal {...base({
            composed: firstComposed,
            onApprove: firstApprove,
        })} />);
        const firstButton = screen.getByTestId('confirm-approve');
        firstButton.focus();
        fireEvent.click(firstButton);
        expect(firstButton).toHaveFocus();
        expect(firstButton).toBeDisabled();

        rerender(<ConfirmActionModal {...base({
            composed: secondComposed,
            decoded: { summary: 'Send 7 JDOG to bc1qnew', details: [], warnings: [] },
            onApprove: secondApprove,
        })} />);

        const secondButton = screen.getByTestId('confirm-approve');
        expect(secondButton).toBeEnabled();
        expect(secondButton).not.toHaveFocus();
        fireEvent.click(secondButton);
        expect(secondApprove).toHaveBeenCalledOnce();
    });

    it('renders a new request with its own signing wallet on the first commit', () => {
        const commits = [];
        const recordCommit = () => {
            const from = document.querySelector('[data-testid="confirm-source"]');
            commits.push({
                request: document.querySelector('[data-testid="confirm-modal"]')?.getAttribute('aria-label'),
                wallet: from?.previousElementSibling?.textContent,
            });
        };
        const { rerender } = render(
            <Profiler id="confirm" onRender={recordCommit}>
                <ConfirmActionModal {...base({ sourceAddress: 'bc1qfirstsource', sourceName: 'Main · First wallet' })} />
            </Profiler>,
        );

        rerender(
            <Profiler id="confirm" onRender={recordCommit}>
                <ConfirmActionModal {...base({
                    composed: { psbt: 'second' },
                    decoded: { summary: 'Send 7 JDOG', details: [{ label: 'Destination', value: 'bc1qxyz' }], warnings: [] },
                    sourceAddress: 'bc1qsecondsource',
                    sourceName: 'Main · Second wallet',
                })} />
            </Profiler>,
        );

        const secondRequestCommits = commits.filter(({ request }) => request === 'Confirm Send 7 JDOG');
        expect(secondRequestCommits.length).toBeGreaterThan(0);
        expect(secondRequestCommits.every(({ wallet }) => wallet?.includes('Second wallet'))).toBe(true);
    });

    it('contains callback throws and rejected event promises', async () => {
        const onApprove = vi.fn(() => { throw new Error('signer stopped'); });
        const onReject = vi.fn(() => Promise.reject(new Error('release stopped')));
        render(<ConfirmActionModal {...base({ onApprove, onReject })} />);

        expect(() => fireEvent.click(screen.getByTestId('confirm-approve'))).not.toThrow();
        await act(async () => {});
        expect(screen.getByTestId('confirm-approve')).toBeEnabled();

        fireEvent.click(screen.getByTestId('confirm-reject'));
        await act(async () => {});
        expect(onReject).toHaveBeenCalledOnce();
    });

    it('shows the queued terminal copy in the signed-not-broadcast phase', () => {
        render(<ConfirmActionModal {...base({ phase: 'signed-not-broadcast' })} />);
        // "will retry" promised an auto-drain that does not exist.
        expect(screen.getByTestId('confirm-queued').textContent).toMatch(/not broadcast yet/i);
        expect(screen.getByTestId('confirm-queued').textContent).not.toMatch(/retry/i);
    });

    it('a tap with no password marks the password field and the top of the page, and signs nothing (G130)', () => {
        const approve = vi.fn();
        const onPasswordChange = vi.fn();
        render(
            <ActionConfirmScreen
                confirmAction={{
                    phase: 'ready',
                    composed: { psbt: 'x', action: 'SEND', chainId: 'bitcoin-mainnet', decoded: DECODED },
                    report: REPORT_PASS,
                    acknowledged: new Set(),
                    acknowledge: vi.fn(),
                    canApprove: true,
                    approve,
                    reject: vi.fn(),
                    error: null,
                    source: null,
                }}
                chainLabel="Bitcoin"
                signerReady={false}
                password=""
                onPasswordChange={onPasswordChange}
            />,
        );
        const button = screen.getByTestId('confirm-approve');
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(approve).not.toHaveBeenCalled();
        expect(screen.getByTestId('confirm-blocked')).toHaveTextContent('Enter your password to approve.');
        expect(screen.getByText('Enter your password.')).toBeTruthy();
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'x' } });
        expect(onPasswordChange).toHaveBeenCalledWith('x');
        expect(screen.queryByText('Enter your password.')).toBeNull();
    });

    it('preflight verdict fail sets aria-live=assertive on the status notice', () => {
        render(<ConfirmActionModal {...base({ report: REPORT_HARD_FAIL, canApprove: false })} />);
        const notice = screen.getByTestId('confirm-status');
        expect(notice.getAttribute('role')).toBe('alert');
        expect(notice.getAttribute('aria-live')).toBe('assertive');
        expect(notice).toHaveTextContent('The checks found a problem with this action.');
        expect(notice).not.toHaveTextContent('bad address');
    });
});
