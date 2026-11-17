// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The confirm screen said "Checked against the network: this will go
// through" for a report the indexer never answered, because the pass test
// only looked for reasons to refuse. These cases pin the positive rule: a
// pass needs the indexer's own valid verdict, and every other report lands in
// not checked, partly checked, warn or fail.
//
// The network cases are built by the SDK's own producer (applyTier1), so a
// change to the finding shape it pushes fails here rather than in the field.

import { describe, expect, it } from 'vitest';
import {
    isNetworkApprovalFinding,
    networkApprovalIsPartial,
    preflightCheckState,
} from '../../../packages/core/src/shared/utils/preflightCheckState.js';
import { preflightCleanPass } from '../../../packages/core/src/shared/components/ConfirmSummary.jsx';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const tier1 = sdkInstalled() ? requireSdkDeep('preflightTier1Findings') : null;

// The SDK's computeVerdict (src/preflight/index.js), restated so the report
// carries the verdict the engine would give these findings.
function verdictOf(findings) {
    if (findings.some((f) => f.severity === 'error')) return 'fail';
    if (findings.some((f) => f.severity === 'warning')) return 'warn';
    return 'pass';
}

// A report as runPreflight assembles it: Tier-2 findings, then Tier-1 precedence.
function sdkReport(tier1Outcome, clientFindings = []) {
    const findings = tier1.applyTier1(clientFindings.map((f) => ({ ...f })), tier1Outcome);
    return {
        schemaVersion: 1, verdict: verdictOf(findings), restricted: false,
        checksRun: [], findings, unverified: [], quote: null, stateHeight: 100,
    };
}

describe.skipIf(!tier1)('preflightCheckState on reports the SDK produces', () => {
    it('gives pass for a valid verdict on one action', () => {
        const report = sdkReport({ kind: 'verdict', valid: true, status: 'valid' });
        expect(preflightCheckState(report)).toBe('pass');
        expect(preflightCleanPass(report)).toBe(true);
    });

    it('gives pass for a batch whose every command the indexer accepted', () => {
        const report = sdkReport({ kind: 'verdict', valid: true, subCommands: [
            { position: 0, action: 'SEND', status: 'valid' },
            { position: 1, action: 'SEND', status: 'valid' },
        ] });
        expect(preflightCheckState(report)).toBe('pass');
    });

    it('gives not checked when no indexer verdict exists at all', () => {
        // applyTier1 with no Tier-1 outcome adds nothing: the report is a
        // clean local pass with no word from the indexer.
        const report = sdkReport(null);
        expect(report.verdict).toBe('pass');
        expect(preflightCheckState(report)).toBe('notChecked');
        expect(preflightCleanPass(report)).toBe(false);
    });

    it('gives not checked on a timeout', () => {
        const report = sdkReport({ kind: 'unavailable', reason: 'tier1 timeout after 4000ms' });
        expect(preflightCheckState(report)).toBe('notChecked');
        expect(preflightCleanPass(report)).toBe(false);
    });

    it('gives not checked on a transport error', () => {
        const report = sdkReport({ kind: 'unavailable', reason: 'fetch failed: ECONNREFUSED' });
        expect(preflightCheckState(report)).toBe('notChecked');
    });

    it('gives not checked when the indexer declined to judge, or was not asked', () => {
        for (const reason of ['denylisted', 'guardInert', 'local-only mode']) {
            expect(preflightCheckState(sdkReport({ kind: 'no-verdict', reason })), reason).toBe('notChecked');
        }
    });

    it('gives partly checked for a batch the indexer only partly judged', () => {
        const report = sdkReport({ kind: 'verdict', valid: true, subCommands: [
            { position: 0, action: 'SEND', status: 'valid' },
            { position: 1, action: 'COINPAY', status: null, refused: null },
        ] });
        expect(report.verdict).toBe('pass');
        expect(preflightCheckState(report)).toBe('partial');
        expect(preflightCleanPass(report)).toBe(false);
    });

    it('gives fail for a negative verdict', () => {
        const report = sdkReport({ kind: 'verdict', valid: false, status: 'invalid: insufficient funds' });
        expect(preflightCheckState(report)).toBe('fail');
        expect(preflightCleanPass(report)).toBe(false);
    });

    it('gives fail when a batch command was rejected under an outer approval', () => {
        const report = sdkReport({ kind: 'verdict', valid: true, subCommands: [
            { position: 0, action: 'SEND', status: 'valid' },
            { position: 1, action: 'SEND', status: 'invalid: insufficient funds' },
        ] });
        expect(preflightCheckState(report)).toBe('fail');
    });

    it('keeps a client warning that a valid verdict demoted to a warning out of pass', () => {
        const report = sdkReport({ kind: 'verdict', valid: true, status: 'valid' }, [{
            code: 'BALANCE_INSUFFICIENT', severity: 'error', source: 'client', overridable: true,
            message: 'reserved', data: { localDeltaApplied: true },
        }]);
        expect(preflightCheckState(report)).toBe('warn');
        expect(preflightCleanPass(report)).toBe(false);
    });
});

describe('preflightCheckState on reports with no indexer answer', () => {
    it('gives not checked for no report (a thrown or failed pre-flight)', () => {
        expect(preflightCheckState(null)).toBe('notChecked');
        expect(preflightCheckState(undefined)).toBe('notChecked');
        expect(preflightCheckState({ verdict: 'pass' })).toBe('notChecked');
        expect(preflightCleanPass(null)).toBe(false);
    });

    it('gives not checked for an empty pass report', () => {
        expect(preflightCheckState({ verdict: 'pass', findings: [], unverified: [] })).toBe('notChecked');
    });

    it('gives not checked for the dev mock finding', async () => {
        const sdk = __createDevMockSdkForTests({ network: 'bitcoin-regtest' });
        const source = await sdk.wallet.deriveAddress(`02${'11'.repeat(32)}`);
        const report = await sdk.preflight('SEND|0|BTC|1|dest', { source });
        expect(report.verdict).toBe('pass');
        expect(report.findings.some((f) => f.code === 'DRYRUN_VALID')).toBe(true);
        expect(preflightCheckState(report)).toBe('notChecked');
        expect(preflightCleanPass(report)).toBe(false);
    });

    it('gives not checked for an approval-looking finding missing its source or data', () => {
        const bare = { code: 'DRYRUN_VALID', severity: 'info', message: 'ok' };
        const cases = [
            bare,
            { ...bare, source: 'dryrun' },
            { ...bare, data: {} },
            { ...bare, source: 'client', data: {} },
            { ...bare, source: 'dryrun', data: null },
            { ...bare, source: 'dryrun', data: [] },
            { ...bare, source: 'dryrun', data: {}, severity: 'warning' },
        ];
        for (const f of cases) {
            expect(isNetworkApprovalFinding(f), JSON.stringify(f)).toBe(false);
        }
        for (const f of cases.slice(0, 6)) {
            expect(preflightCheckState({ verdict: 'pass', findings: [f] }), JSON.stringify(f)).toBe('notChecked');
        }
    });

    it('gives not checked when an approval sits beside a timeout', () => {
        const report = { verdict: 'pass', findings: [
            { code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} },
            { code: 'DRYRUN_UNAVAILABLE', severity: 'info', source: 'dryrun', message: 'timeout', data: {} },
        ] };
        expect(preflightCheckState(report)).toBe('notChecked');
    });

    it('gives not checked for an approval under a verdict it does not know', () => {
        const report = { verdict: 'maybe', findings: [
            { code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} },
        ] };
        expect(preflightCheckState(report)).toBe('notChecked');
    });
});

describe('preflightCheckState partial and held-back reports', () => {
    const approval = (data = {}) => ({ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data });

    it('reads malformed batch counts as partly judged', () => {
        expect(networkApprovalIsPartial(approval({ subCommandCount: 3 }))).toBe(true);
        expect(networkApprovalIsPartial(approval({ accepted: 3 }))).toBe(true);
        expect(networkApprovalIsPartial(approval({ subCommandCount: 3, accepted: 4 }))).toBe(true);
        expect(networkApprovalIsPartial(approval({ subCommandCount: '3', accepted: '3' }))).toBe(true);
        expect(networkApprovalIsPartial(approval({ subCommandCount: 3, accepted: 3 }))).toBe(false);
        expect(networkApprovalIsPartial(approval({}))).toBe(false);
    });

    it('gives partly checked for a restricted report or unverified checks', () => {
        expect(preflightCheckState({ verdict: 'pass', restricted: true, findings: [approval()] })).toBe('partial');
        expect(preflightCheckState({
            verdict: 'pass', findings: [approval()], unverified: [{ check: 'balance', reason: 'timeout' }],
        })).toBe('partial');
    });

    it('gives partly checked when a command was left unjudged', () => {
        expect(preflightCheckState({ verdict: 'pass', findings: [approval(), {
            code: 'DRYRUN_SUBCOMMAND_UNJUDGED', severity: 'info', source: 'dryrun', message: 'unjudged',
            data: { commandIndex: 1 },
        }] })).toBe('partial');
    });

    it('gives fail for a fail verdict even with an approval in the findings', () => {
        expect(preflightCheckState({ verdict: 'fail', findings: [approval()] })).toBe('fail');
    });
});
