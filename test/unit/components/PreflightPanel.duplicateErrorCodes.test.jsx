// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-sub-command override identity (§4.2 override, §5.2.4 panel).
//
// The defect: the errors list and the Approve gate both keyed the
// acknowledged set on `f.code` alone. That held only while a report could
// carry at most one error per code, and it cannot. The SDK's
// `pushSubCommandFindings` (xchain-sdk/src/preflight/index.js) pushes one
// `DRYRUN_SUBCOMMAND_INVALID` ERROR per invalid batch sub-command, each
// tagged with its own `data.commandIndex`, and the batch check pushes one
// `PARSE_INVALID` per unparseable command the same way. Under a code-scoped
// set, ticking "Sign anyway" on batch command 2 also satisfied command 5, so
// one click cleared several distinct network-rejected commands, and React saw
// duplicate keys so a row could be dropped.
//
// The fixtures below are the SHAPES the SDK produces: the `data.commandIndex`
// on the dry-run findings is `s.position`, and the message wording is the
// SDK's own.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';
import { canApproveWithReport, toggleAcknowledged }
    from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { preflightFindingKey }
    from '../../../packages/core/src/shared/utils/preflightFindingKey.js';

afterEach(cleanup);

const subCommandError = (position) => ({
    code: 'DRYRUN_SUBCOMMAND_INVALID',
    severity: 'error',
    source: 'dryrun',
    overridable: true,
    message: `The network reports batch command ${position + 1} will fail: insufficient funds.`
        + ' A batch is not atomic, so the other commands still apply.',
    data: { commandIndex: position, action: 'SEND', status: 'insufficient funds' },
});

const reportWith = (findings) => ({
    schemaVersion: 1,
    verdict: 'fail',
    restricted: false,
    checksRun: [],
    findings,
    unverified: [],
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

const mount = (report, acknowledged = new Set()) =>
    render(<PreflightPanel report={report} acknowledged={acknowledged} onAcknowledge={() => {}} />);

describe('preflightFindingKey', () => {
    it('is the bare code when the finding is not part of a batch', () => {
        expect(preflightFindingKey({ code: 'DRYRUN_INVALID', data: {} })).toBe('DRYRUN_INVALID');
        expect(preflightFindingKey({ code: 'DRYRUN_INVALID' })).toBe('DRYRUN_INVALID');
    });

    it('separates two findings that share a code across sub-commands', () => {
        expect(preflightFindingKey(subCommandError(1)))
            .not.toBe(preflightFindingKey(subCommandError(4)));
    });

    // commandIndex 0 is falsy, and the first batch command is exactly the one a
    // truthiness test would silently fold back onto the bare code.
    it('keys command 0 per-command rather than folding it onto the code', () => {
        expect(preflightFindingKey(subCommandError(0))).toBe('DRYRUN_SUBCOMMAND_INVALID#0');
    });
});

describe('PreflightPanel: repeated error codes in one batch report', () => {
    it('renders one row per rejected sub-command', () => {
        mount(reportWith([subCommandError(1), subCommandError(4)]));
        const rows = screen.getAllByText(/The network reports batch command/);
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('batch command 2');
        expect(rows[1].textContent).toContain('batch command 5');
    });

    it('gives each sub-command its own override checkbox', () => {
        mount(reportWith([subCommandError(1), subCommandError(4)]));
        expect(screen.getByTestId('ack-DRYRUN_SUBCOMMAND_INVALID#1')).toBeTruthy();
        expect(screen.getByTestId('ack-DRYRUN_SUBCOMMAND_INVALID#4')).toBeTruthy();
    });

    // The bug in its visible form: acknowledging one command left the other
    // one's checkbox ticked too, so the user was shown consent they never gave.
    it('does not tick the other sub-command when one is acknowledged', () => {
        mount(reportWith([subCommandError(1), subCommandError(4)]),
            new Set(['DRYRUN_SUBCOMMAND_INVALID#1']));
        expect(screen.getByTestId('ack-DRYRUN_SUBCOMMAND_INVALID#1').checked).toBe(true);
        expect(screen.getByTestId('ack-DRYRUN_SUBCOMMAND_INVALID#4').checked).toBe(false);
    });

    // A single-code report keeps the identity it always had, so every existing
    // acknowledgment (and every e2e testid built on it) is unchanged.
    it('keeps the bare-code testid for a non-batch error', () => {
        mount(reportWith([{
            code: 'DRYRUN_INVALID', severity: 'error', source: 'dryrun', overridable: true,
            message: 'The network reports this will fail: rejected.', data: {},
        }]));
        expect(screen.getByTestId('ack-DRYRUN_INVALID')).toBeTruthy();
    });
});

describe('canApproveWithReport: one ack clears one sub-command', () => {
    const report = reportWith([subCommandError(1), subCommandError(4)]);

    it('still blocks after acknowledging only the first rejected command', () => {
        expect(canApproveWithReport(report, new Set(['DRYRUN_SUBCOMMAND_INVALID#1']))).toBe(false);
    });

    // The pre-fix behaviour, pinned as a negative: the bare code must no longer
    // satisfy the gate for a batch finding at all.
    it('is not satisfied by the bare shared code', () => {
        expect(canApproveWithReport(report, new Set(['DRYRUN_SUBCOMMAND_INVALID']))).toBe(false);
    });

    it('allows only once every rejected command is acknowledged individually', () => {
        const acked = toggleAcknowledged(
            toggleAcknowledged(new Set(), 'DRYRUN_SUBCOMMAND_INVALID#1'),
            'DRYRUN_SUBCOMMAND_INVALID#4');
        expect(canApproveWithReport(report, acked)).toBe(true);
        // And un-ticking one re-blocks, per the checkbox contract.
        expect(canApproveWithReport(report,
            toggleAcknowledged(acked, 'DRYRUN_SUBCOMMAND_INVALID#4'))).toBe(false);
    });

    // A non-overridable per-command error (PARSE_INVALID is `local`, so
    // addFinding stamps overridable:false) must stay a hard block no matter
    // what is in the set; the per-command key changes nothing there.
    it('leaves a non-overridable per-command error hard-blocking', () => {
        const hard = reportWith([{
            code: 'PARSE_INVALID', severity: 'error', source: 'client', overridable: false,
            message: 'Batch command 3 does not parse (MALFORMED).', data: { commandIndex: 2 },
        }]);
        expect(canApproveWithReport(hard, new Set(['PARSE_INVALID#2']))).toBe(false);
    });
});
