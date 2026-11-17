// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm screen's "Checked against the network: this will go through"
// line is a claim the user signs on. It used to render for a report the
// indexer never answered (no Tier-1 finding at all) and for the dev shell's
// mock finding, so a user could approve a transaction the indexer would
// reject, believing it was checked. This suite renders the real confirm page
// for every report that lacks the indexer's own valid verdict and asserts the
// line never appears, with a positive control so the table cannot pass by
// the line never rendering at all.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { canApproveWithReport } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

afterEach(() => cleanup());

// The status notice's pass words (G127 revised 2026-11-16: the green status
// is first on the page), and the retired pass line's words, which no copy may
// use again.
const PASS_COPY = 'Checked: this will go through.';
const RETIRED_PASS_COPY = 'Checked against the network: this will go through.';
const tier1 = sdkInstalled() ? requireSdkDeep('preflightTier1Findings') : null;

function verdictOf(findings) {
    if (findings.some((f) => f.severity === 'error')) return 'fail';
    if (findings.some((f) => f.severity === 'warning')) return 'warn';
    return 'pass';
}

function report(findings, extra = {}) {
    return {
        schemaVersion: 1, verdict: verdictOf(findings), restricted: false, checksRun: [],
        findings, unverified: [], quote: null, stateHeight: 100, ...extra,
    };
}

function sdkReport(outcome) {
    return report(tier1.applyTier1([], outcome));
}

function renderConfirm(rpt) {
    const acknowledged = new Set();
    return render(
        <ActionConfirmScreen
            confirmAction={{
                phase: 'ready',
                composed: { chainId: 'bitcoin-mainnet', psbt: 'x', action: 'SEND', actionString: 'SEND|0|XCHAIN|1|bc1qdest' },
                report: rpt,
                acknowledged,
                acknowledge: () => {},
                canApprove: canApproveWithReport(rpt, acknowledged),
                approve: () => {},
                reject: () => {},
                error: null,
                source: null,
            }}
            chainLabel="Bitcoin"
            signerReady
            password=""
            onPasswordChange={() => {}}
        />,
    );
}

// Confirm Standard (G127 revised 2026-11-16): the status notice is first on
// the page, green "Checked: this will go through." only on the indexer's own
// full approval. Anything short of it shows the red status, and no copy ever
// claims the transaction will go through.
function expectNoPassCopy(label) {
    expect(screen.queryByTestId('confirm-checked'), label).toBeNull();
    expect(document.body.textContent, label).not.toContain(PASS_COPY);
    expect(document.body.textContent, label).not.toContain(RETIRED_PASS_COPY);
    const notice = screen.queryByTestId('confirm-status');
    expect(notice, `${label}: the status says it was not fully checked`).not.toBeNull();
    expect(notice.getAttribute('data-tone'), label).toBe('danger');
    expect(['notChecked', 'partial', 'warn', 'fail'], label).toContain(notice.getAttribute('data-state'));
}

describe('security: the confirm page treats only the indexer verdict as checked', () => {
    it('has pass copy to look for', () => {
        expect(PASS_COPY).toMatch(/this will go through/);
    });

    it.skipIf(!tier1)('shows the green status only for a real indexer approval (positive control)', () => {
        renderConfirm(sdkReport({ kind: 'verdict', valid: true, status: 'valid' }));
        const notice = screen.getByTestId('confirm-status');
        expect(notice.getAttribute('data-tone')).toBe('success');
        expect(notice.getAttribute('data-state')).toBe('pass');
        expect(notice.textContent).toBe(PASS_COPY);
        expect(document.body.textContent).not.toContain(RETIRED_PASS_COPY);
    });

    it('never shows green while the check is still running', () => {
        const acknowledged = new Set();
        render(
            <ActionConfirmScreen
                confirmAction={{
                    phase: 'preflighting',
                    composed: { chainId: 'bitcoin-mainnet', psbt: 'x', action: 'SEND', actionString: 'SEND|0|XCHAIN|1|bc1qdest' },
                    report: null,
                    acknowledged,
                    acknowledge: () => {},
                    canApprove: false,
                    approve: () => {},
                    reject: () => {},
                    error: null,
                    source: null,
                }}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
        );
        expect(document.body.textContent).not.toContain(PASS_COPY);
        expect(screen.getByTestId('confirm-status').getAttribute('data-state')).toBe('checking');
        expect(screen.getByTestId('confirm-status').getAttribute('data-tone')).not.toBe('success');
    });

    it('never renders the pass line without a report', () => {
        renderConfirm(null);
        expectNoPassCopy('null report');
    });

    it('never renders the pass line for a pass the indexer did not give', () => {
        const forged = [
            ['empty findings', report([])],
            ['bare DRYRUN_VALID', report([{ code: 'DRYRUN_VALID', severity: 'info', message: 'ok' }])],
            ['client-sourced DRYRUN_VALID', report([{ code: 'DRYRUN_VALID', severity: 'info', source: 'client', message: 'ok', data: {} }])],
            ['DRYRUN_VALID with no data', report([{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok' }])],
            ['approval beside a timeout', report([
                { code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} },
                { code: 'DRYRUN_UNAVAILABLE', severity: 'info', source: 'dryrun', message: 'timeout', data: {} },
            ])],
            ['restricted approval', report([{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }], { restricted: true })],
        ];
        for (const [label, rpt] of forged) {
            const { unmount } = renderConfirm(rpt);
            expectNoPassCopy(label);
            unmount();
        }
    });

    it('never renders the pass line for the dev mock pre-flight', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-regtest' });
        const source = await sdk.wallet.deriveAddress(`02${'11'.repeat(32)}`);
        const rpt = await sdk.preflight('SEND|0|BTC|1|dest', { source });
        expect(rpt.verdict).toBe('pass');
        renderConfirm(rpt);
        expectNoPassCopy('dev mock');
    });

    it.skipIf(!tier1)('never renders the pass line for an SDK report without a full approval', () => {
        const cases = [
            ['no Tier-1 outcome', report(tier1.applyTier1([], null))],
            ['timeout', sdkReport({ kind: 'unavailable', reason: 'tier1 timeout after 4000ms' })],
            ['transport error', sdkReport({ kind: 'unavailable', reason: 'fetch failed' })],
            ['declined', sdkReport({ kind: 'no-verdict', reason: 'denylisted' })],
            ['local-only', sdkReport({ kind: 'no-verdict', reason: 'local-only mode' })],
            ['negative verdict', sdkReport({ kind: 'verdict', valid: false, status: 'invalid: insufficient funds' })],
            ['partly judged batch', sdkReport({ kind: 'verdict', valid: true, subCommands: [
                { position: 0, action: 'SEND', status: 'valid' },
                { position: 1, action: 'COINPAY', status: null, refused: null },
            ] })],
        ];
        for (const [label, rpt] of cases) {
            const { unmount } = renderConfirm(rpt);
            expectNoPassCopy(label);
            unmount();
        }
    });
});
