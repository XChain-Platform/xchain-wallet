// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The confirm screen must disclose the XCHAIN-mode protocol fee.
//
// The screen quoted the miner fee to eight decimals and said nothing about
// the protocol fee unless the user had switched to native-coin payment - so
// in the DEFAULT mode the larger of the two charges was invisible.
// put the number on `report.quote.xchainFee`; this is the wiring that reads
// it, and the guards that keep it from double-counting the native lane.
//
// Confirm Standard (G127 revised 2026-11-16): there is no Total block; each
// fee is its own row in the facts card. A fee that cannot be estimated keeps
// its row ("Not known yet"), never rendered as "Unavailable" or said twice.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';

afterEach(() => cleanup());

const DECODED = { summary: 'Issue 1000 S19FEE', details: [], warnings: [] };

// What sdk.preflight lands after: the echoed fee record on the quote.
const REPORT = (xchainFee) => ({
    verdict: 'pass', restricted: false, unverified: [], stateHeight: 100,
    findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }],
    quote: { valid: true, status: 'valid', xchainFee, blockIndex: 100 },
});

const NATIVE_FEE_FINDING = {
    code: 'NATIVE_FEE_FORFEIT',
    severity: 'warning',
    message: 'Any attached native-coin fee output is forfeited.',
};

const NETWORK_FEE = { amount: '0.00001176', ticker: 'BTC', fiat: null, estimate: false };

function base(overrides = {}) {
    return {
        phase: 'ready',
        composed: { psbt: 'x', networkFeeSats: 1176, protocolFeeSats: null, quote: null },
        report: REPORT('0.50000000'), reportLoading: false,
        acknowledged: new Set(), onAcknowledge: () => {}, canApprove: true,
        onApprove: vi.fn(), onReject: vi.fn(), decoded: DECODED, simulation: null,
        chainLabel: 'Bitcoin', credentials: <input data-testid="pw" />, credentialsReady: true,
        variant: 'action', nativeTicker: 'BTC', networkFee: NETWORK_FEE,
        ...overrides,
    };
}

function unknownProtocolFeeNamed() {
    const row = screen.queryByTestId('confirm-fee-protocol');
    return Boolean(row && row.textContent === 'Not known yet');
}

describe('confirm screen protocol-fee disclosure', () => {

    it('shows an XCHAIN protocol fee once, as its own row in the facts card', () => {
        render(<ConfirmActionModal {...base()} />);
        const fee = screen.getByTestId('confirm-fee-protocol');
        expect(fee.textContent).toBe('0.5 XCHAIN');
        expect(screen.queryByTestId('confirm-total-line')).toBeNull();
        expect(screen.getByTestId('confirm-modal').textContent.match(/0\.5 XCHAIN/g)).toHaveLength(1);
        expect(screen.getByTestId('confirm-facts').querySelector('[data-testid="confirm-fee-protocol"]')).toBe(fee);
    });

    it('keeps miner and protocol fees as distinct rows', () => {
        render(<ConfirmActionModal {...base()} />);
        expect(screen.getByTestId('confirm-fee-network').textContent).toBe('0.00001176 BTC');
        expect(screen.getByTestId('confirm-fee-protocol').textContent).toBe('0.5 XCHAIN');
        expect(screen.getByTestId('confirm-facts').querySelectorAll('[data-testid^="confirm-fee-"]')).toHaveLength(2);
    });

    it('shows the fee even when the PSBT could not price its miner fee', () => {
        // The two are independent: an un-priceable miner fee must not take the
        // protocol fee down with it, and the miner fee is still named.
        render(<ConfirmActionModal {...base({ networkFee: null })} />);
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('Not known yet');
        expect(screen.getByTestId('confirm-fee-protocol')).toHaveTextContent('0.5 XCHAIN');
    });

    it('does not show the XCHAIN row when the fee is paid in the native coin', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', protocolFeeSats: 2000, quote: { requiredFeeSats: 2000 } },
            formatNativeFee: () => '~$2.00',
        })} />);
        const row = screen.getByTestId('confirm-fee-protocol');
        expect(row.textContent).toBe('0.00002 BTC ($2.00), not refunded if rejected');
        expect(screen.getByTestId('confirm-modal').textContent).not.toContain('XCHAIN');
    });

    it('hides the native-fee advisory when ISSUE has no coin fee output', () => {
        render(<ConfirmActionModal {...base({
            report: {
                ...REPORT('0.50000000'),
                verdict: 'warn',
                // The indexer's approval stays; only the advisory is filtered.
                findings: [...REPORT('0.50000000').findings, NATIVE_FEE_FINDING],
            },
        })} />);

        expect(screen.getByTestId('confirm-modal').textContent).not.toMatch(/forfeited/i);
        // The filtered report is a clean pass: no warning slot at all.
        expect(screen.queryByTestId('confirm-warning')).toBeNull();
    });

    it('shows one forfeiture disclosure when ISSUE carries a native fee output', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', protocolFeeSats: 2000, quote: { requiredFeeSats: 2000 } },
            report: {
                ...REPORT(null),
                verdict: 'warn',
                findings: [NATIVE_FEE_FINDING],
            },
        })} />);

        expect(screen.getAllByText(/not refunded if rejected/)).toHaveLength(1);
        expect(screen.getByTestId('confirm-modal').textContent).not.toMatch(/forfeited/i);
    });

    it('shows nothing while the report is still streaming in', () => {
        render(<ConfirmActionModal {...base({ phase: 'preflighting', report: null, reportLoading: true })} />);
        expect(screen.queryByTestId('confirm-fee-protocol')).toBeNull();
        expect(unknownProtocolFeeNamed()).toBe(false);
    });

    it('shows nothing for a zero-fee action', () => {
        render(<ConfirmActionModal {...base({ report: REPORT('0.00000000') })} />);
        expect(screen.queryByTestId('confirm-fee-protocol')).toBeNull();
        expect(unknownProtocolFeeNamed()).toBe(false);
    });

    it('says when the protocol fee cannot be estimated, never as Unavailable', () => {
        render(<ConfirmActionModal {...base({
            report: { verdict: 'unknown', findings: [] },
            composed: { psbt: 'x', networkFeeSats: 1176, xchainFee: null },
        })} />);
        expect(unknownProtocolFeeNamed()).toBe(true);
        expect(screen.getByTestId('confirm-modal').textContent).not.toMatch(/unavailable/i);
        // There is no fee total that an unpriced fee would understate.
        expect(screen.queryByTestId('confirm-total-fiat')).toBeNull();
    });

    describe('unknown protocol fee by action', () => {
        const noQuote = (action, extra = {}) => base({
            report: { verdict: 'unknown', findings: [] },
            composed: { psbt: 'x', networkFeeSats: 1176, xchainFee: null, action, ...extra },
        });

        it.each(['SEND', 'MINT', 'send'])('names no protocol fee for free action %s', (action) => {
            render(<ConfirmActionModal {...noQuote(action)} />);
            expect(unknownProtocolFeeNamed()).toBe(false);
        });

        it('shows a protocol fee the host reports for a MINT envelope', () => {
            render(<ConfirmActionModal {...base({
                report: REPORT('0.50000000'),
                composed: { psbt: 'x', networkFeeSats: 1176, xchainFee: null, action: 'MINT' },
            })} />);
            expect(screen.getByTestId('confirm-fee-protocol').textContent).toMatch(/0\.5 XCHAIN/);
        });

        it('reads the action from the action string when the name is absent', () => {
            render(<ConfirmActionModal {...noQuote(undefined, { actionString: 'MINT|0|X|1' })} />);
            expect(unknownProtocolFeeNamed()).toBe(false);
        });

        it.each([
            ['FILE request envelope', { actionData: { action: 'FILE', params: {} } }],
            ['LINK decoded envelope', { decoded: { action: 'LINK' } }],
            ['ADDRESS commit', { envelope: { commit: { actionData: { action: 'ADDRESS', params: {} } } } }],
            ['PRICE reveal', { envelope: { reveal: { decoded: { action: 'PRICE' } } } }],
        ])('names no protocol fee when a free action is carried by a %s', (_label, shape) => {
            render(<ConfirmActionModal {...noQuote(undefined, shape)} />);
            expect(unknownProtocolFeeNamed()).toBe(false);
        });

        it('names it for a fee-bearing action carried by a chunk reveal', () => {
            render(<ConfirmActionModal {...noQuote(undefined, {
                envelope: { reveal: { actionData: { action: 'DEPLOY', params: {} } } },
            })} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });

        it('names it for a new ISSUE when its quote is missing', () => {
            render(<ConfirmActionModal {...noQuote('ISSUE')} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });

        it('names none for an ISSUE update known to be free from its compose quote', () => {
            render(<ConfirmActionModal {...noQuote('ISSUE', { protocolFeeKnownFree: true })} />);
            expect(unknownProtocolFeeNamed()).toBe(false);
        });

        it('keeps the unknown row when only the form says the fee is zero', () => {
            render(<ConfirmActionModal {...noQuote('LIST')}
                summary={{ protocolFee: { amount: '0', ticker: 'XCHAIN' } }} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });

        it('keeps the unknown row when the form leaves its fee amount empty', () => {
            render(<ConfirmActionModal {...noQuote('ISSUE')}
                summary={{ protocolFee: { amount: '', ticker: 'XCHAIN' } }} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });

        it('shows no protocol row when the compose quote is known free, whatever the form says', () => {
            render(<ConfirmActionModal {...noQuote('LIST', { protocolFeeKnownFree: true })}
                summary={{ protocolFee: { amount: '0', ticker: 'XCHAIN' } }} />);
            expect(screen.queryByTestId('confirm-fee-protocol')).toBeNull();
        });

        it('falls back to the form\'s positive figure when the compose quote is missing', () => {
            render(<ConfirmActionModal {...noQuote('ISSUE')}
                summary={{ protocolFee: { amount: '0.25', ticker: 'XCHAIN' } }} />);
            expect(screen.getByTestId('confirm-fee-protocol').textContent).toMatch(/0\.25 XCHAIN/);
        });

        it.each(['ORDER', 'ORDER_MATCH', 'DEPLOY_CHUNK'])('names it for %s', (action) => {
            render(<ConfirmActionModal {...noQuote(action)} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });

        it('names it when the action cannot be identified', () => {
            render(<ConfirmActionModal {...noQuote(undefined)} />);
            expect(unknownProtocolFeeNamed()).toBe(true);
        });
    });

    it('does not claim an XCHAIN fee on a caller-supplied PSBT', () => {
        // The wallet did not build those bytes and cannot tell which lane
        // paid their fee, so "from your XCHAIN balance" could be flatly wrong.
        render(<ConfirmActionModal {...base({ variant: 'psbt', psbtPanel: <div /> })} />);
        expect(screen.queryByTestId('confirm-fee-protocol')).toBeNull();
        expect(unknownProtocolFeeNamed()).toBe(false);
    });

    it('names a priced oracle usage fee once, as its own row', () => {
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', networkFeeSats: 1176, oracleFeeQuote: { requiredFeeSats: 1500, belowDust: false } },
        })} />);
        const row = screen.getByTestId('confirm-fee-oracle');
        expect(row.textContent).toBe('0.000015 BTC');
        expect(screen.getByTestId('confirm-fee-protocol').textContent).not.toMatch(/oracle/i);
        expect(screen.queryByTestId('confirm-total-main')).toBeNull();
        expect([...screen.getByTestId('confirm-facts').querySelectorAll('[data-testid^="confirm-fee-"]')]
            .map((fee) => fee.textContent)).toEqual(['0.00001176 BTC', '0.5 XCHAIN', '0.000015 BTC']);
        expect(screen.getByTestId('confirm-modal').textContent.match(/0\.000015 BTC/g)).toHaveLength(1);
    });

    it('draws no oracle row when the quote appended no output', () => {
        for (const oracleFeeQuote of [null, { requiredFeeSats: 300, belowDust: true }, { requiredFeeSats: 0 }, { requiredFeeSats: 'n/a' }]) {
            render(<ConfirmActionModal {...base({ composed: { psbt: 'x', oracleFeeQuote } })} />);
            expect(screen.queryByTestId('confirm-fee-oracle')).toBeNull();
            cleanup();
        }
    });

    it('draws no oracle row on a caller-supplied PSBT', () => {
        render(<ConfirmActionModal {...base({
            variant: 'psbt', psbtPanel: <div />,
            composed: { psbt: 'x', oracleFeeQuote: { requiredFeeSats: 1500 } },
        })} />);
        expect(screen.queryByTestId('confirm-fee-oracle')).toBeNull();
    });

    it('does not claim an XCHAIN fee on a bare native payment', () => {
        // No XChain action, so no protocol fee at all.
        render(<ConfirmActionModal {...base({
            composed: { psbt: 'x', bareNativePayment: true }, report: null,
        })} />);
        expect(screen.queryByTestId('confirm-fee-protocol')).toBeNull();
        expect(unknownProtocolFeeNamed()).toBe(false);
    });
});

// A dry run that never answered (an aborted request or a timeout) on a
// fee-bearing action: the SDK's forfeit warning is filtered out, and a check
// that also missed its read beside the dry run (an activation lookup the
// explorer layer's backoff held past its budget) must not keep the notice at
// the red "check this" warning. Nothing judged the action, so it is not
// checked. A rejection the dry run did answer keeps the failure.
describe('confirm status when the dry run does not answer', () => {
    const UNANSWERED = {
        code: 'DRYRUN_UNAVAILABLE', severity: 'info', source: 'dryrun', data: {},
        message: 'The network dry-run was unavailable (Explorer request failed: Network Error); relying on client checks.',
    };
    const MISSED_READ = { check: 'ISSUE_TICK_COIN_PREFIX', reason: 'activation lookup unavailable' };
    const unanswered = (extra = {}) => ({
        verdict: 'warn', restricted: false, stateHeight: null, quote: null,
        findings: [NATIVE_FEE_FINDING, UNANSWERED],
        unverified: [MISSED_READ],
        ...extra,
    });

    it('says not checked, never the warning, when a read beside it also missed', () => {
        render(<ConfirmActionModal {...base({ report: unanswered() })} />);
        const status = screen.getByTestId('confirm-status');
        expect(status.getAttribute('data-state')).toBe('notChecked');
        expect(status.textContent).toContain('Not checked with the network');
        expect(status.textContent).not.toContain('Check this before you approve');
    });

    it('says not checked for a restricted report the network never judged', () => {
        render(<ConfirmActionModal {...base({ report: unanswered({ unverified: [], restricted: true }) })} />);
        expect(screen.getByTestId('confirm-status').getAttribute('data-state')).toBe('notChecked');
    });

    it('keeps a warning the client checks raised', () => {
        const tick = { code: 'TICK_FORMAT', severity: 'warning', source: 'client', message: 'reserved name' };
        render(<ConfirmActionModal {...base({
            report: unanswered({ findings: [NATIVE_FEE_FINDING, tick, UNANSWERED] }),
        })} />);
        expect(screen.getByTestId('confirm-status').getAttribute('data-state')).toBe('warn');
    });

    it('keeps the failure when the dry run answered with a rejection', () => {
        const rejected = {
            code: 'DRYRUN_INVALID', severity: 'error', source: 'dryrun', overridable: true,
            message: 'The network reports this will fail: invalid: TICK (exists)', data: { status: 'invalid: TICK (exists)' },
        };
        render(<ConfirmActionModal {...base({
            report: { ...unanswered(), verdict: 'fail', findings: [NATIVE_FEE_FINDING, rejected], unverified: [MISSED_READ] },
        })} />);
        expect(screen.getByTestId('confirm-status').getAttribute('data-state')).toBe('fail');
    });

    it('keeps an approved report with a check it could not read short of a clean pass', () => {
        render(<ConfirmActionModal {...base({
            report: {
                ...REPORT('0.50000000'), verdict: 'warn',
                findings: [...REPORT('0.50000000').findings, NATIVE_FEE_FINDING],
                unverified: [MISSED_READ],
            },
        })} />);
        expect(['pass', 'notChecked']).not.toContain(screen.getByTestId('confirm-status').getAttribute('data-state'));
    });
});
