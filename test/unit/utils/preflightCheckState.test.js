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
    isSettleTimeUnverified,
    networkApprovalIsPartial,
    preflightCheckState,
} from '../../../packages/core/src/shared/utils/preflightCheckState.js';
import { preflightCleanPass } from '../../../packages/core/src/shared/components/ConfirmSummary.jsx';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';

const tier1 = sdkInstalled() ? requireSdkDeep('preflightTier1Findings') : null;
const engine = sdkInstalled() ? requireSdkDeep('preflightEngine') : null;

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

// Operator 2026-11-17: an approved edition mint whose only gaps are checks the
// network makes at settlement is a calm note, not "Only partly checked". Every
// other cause of a partial check keeps the partial state.
describe('preflightCheckState settle-time checks', () => {
    const approval = (data = {}) => ({ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data });
    // The SDK's entry verbatim (xchain-sdk src/preflight/checks/mint.js).
    const HEADROOM = {
        check: 'MINT_ADDRESS_HEADROOM',
        reason: 'per-address minted headroom, allow/block lists, and mint-guard outcome are server-side only',
    };

    it('gives settleChecks when every unverified item is a settle-time check', () => {
        const report = { verdict: 'pass', findings: [approval()], unverified: [HEADROOM] };
        expect(preflightCheckState(report)).toBe('settleChecks');
        // Still not a clean pass: the green line stays the full approval's.
        expect(preflightCleanPass(report)).toBe(false);
    });

    // PRICE_STATE is declared on every PRICE (xchain-sdk misc.js); a PRICE v1 has
    // no authority rule at all. The other per-action notes there name state the
    // network judges per address (stakes, polls, contracts), so they stay partial.
    it('settles a PRICE publish, and keeps the rest of the per-action notes partial', () => {
        const price = { check: 'PRICE_STATE', reason: 'oracle authority (capability stake) resolves server-side' };
        expect(preflightCheckState({ verdict: 'pass', findings: [approval()], unverified: [price] })).toBe('settleChecks');
        for (const check of [
            'STAKE_STATE', 'UNSTAKE_STATE',
            'VOTE_CREATE_STATE', 'VOTE_STATE', 'VOTE_FINALIZE_STATE', 'VOTE_DELEGATION_STATE',
            'EXECUTE_STATE', 'COINPAY_STATE', 'SLEEP_STATE',
        ]) {
            expect(preflightCheckState({ verdict: 'pass', findings: [approval()], unverified: [{ check, reason: 'declared' }] })).toBe('partial');
        }
    });

    it('stays partial when a settle-time item sits beside any other', () => {
        expect(preflightCheckState({
            verdict: 'pass', findings: [approval()],
            unverified: [HEADROOM, { check: 'AMOUNT_REPRESENTABILITY', reason: 'declared' }],
        })).toBe('partial');
    });

    it('stays partial for a partly judged batch with only settle-time items', () => {
        expect(preflightCheckState({
            verdict: 'pass', findings: [approval({ subCommandCount: 3, accepted: 2 })], unverified: [HEADROOM],
        })).toBe('partial');
    });

    it('stays partial for a command left unjudged with only settle-time items', () => {
        expect(preflightCheckState({ verdict: 'pass', unverified: [HEADROOM], findings: [approval(), {
            code: 'DRYRUN_SUBCOMMAND_UNJUDGED', severity: 'info', source: 'dryrun', message: 'unjudged',
            data: { commandIndex: 1 },
        }] })).toBe('partial');
    });

    it('stays partial for a restricted report with only settle-time items', () => {
        expect(preflightCheckState({
            verdict: 'pass', restricted: true, findings: [approval()], unverified: [HEADROOM],
        })).toBe('partial');
    });

    it('matches the check code, never the reason text', () => {
        expect(isSettleTimeUnverified(HEADROOM)).toBe(true);
        expect(isSettleTimeUnverified({ check: 'TOKEN_LOOKUP', reason: HEADROOM.reason })).toBe(false);
        expect(isSettleTimeUnverified({ reason: HEADROOM.reason })).toBe(false);
        expect(isSettleTimeUnverified(null)).toBe(false);
    });

    // Operator 2026-11-18: every fixed declaration for a rule the network decides at
    // settlement counts; failed reads and states the SDK could not judge never do.
    it('counts the fixed settle-time declarations and nothing read-driven', () => {
        for (const check of ['LEG_AMOUNT_CONSOLIDATION', 'SEND_RESTRICTIONS', 'GATED_HANDOFF_REF',
            'DESTROY_RESTRICTIONS', 'AIRDROP_TOTAL_VS_BALANCE', 'DIVIDEND_DEBIT_TOTAL', 'DISPENSER_RESTRICTIONS',
            'DISPENSE_SETTLEMENT_MATCH', 'ORDER_RESTRICTIONS', 'SWAP_RESTRICTIONS', 'ISSUE_LOCK_RATCHETS',
            'ISSUE_BRIDGE_POLICY_EXCLUSION']) {
            expect(isSettleTimeUnverified({ check, reason: 'x' }), check).toBe(true);
        }
        for (const check of ['AMOUNT_REPRESENTABILITY', 'TOKEN_LOOKUP', 'BALANCE_LOOKUP', 'NATIVE_BALANCE_LOOKUP',
            'BALANCE_INSUFFICIENT', 'AMOUNT_FORMAT_INVALID', 'MINT_OVER_MAX', 'SUPPLY_EXCEEDED', 'NOT_OWNER',
            'LIST_REFERENCE_VALIDITY', 'ORDER_REFERENCE', 'DISPENSER_MAX_REFILLS', 'DISPENSER_ORIGIN_STANDING',
            'ISSUE_BRIDGE_ACTIVATION', 'CARET_REF_UNRESOLVABLE', 'STAKE_STATE']) {
            expect(isSettleTimeUnverified({ check, reason: 'x' }), check).toBe(false);
        }
    });

    it('lets warn, fail and not checked outrank settle-time items', () => {
        expect(preflightCheckState({ verdict: 'fail', findings: [approval()], unverified: [HEADROOM] })).toBe('fail');
        expect(preflightCheckState({ verdict: 'warn', findings: [approval()], unverified: [HEADROOM] })).toBe('warn');
        expect(preflightCheckState({ verdict: 'pass', findings: [], unverified: [HEADROOM] })).toBe('notChecked');
    });
});

// The report the wallet's own SDK builds for a capped mint the indexer
// approves. If the SDK starts declaring another gap here, this fails, because
// the calm note would then stop showing on edition mints.
describe.skipIf(!engine)('preflightCheckState on the SDK report for a capped mint', () => {
    it('carries only the settle-time item and gives settleChecks', async () => {
        const token = { tick: 'EDITION', info: { tick: 'EDITION', decimals: 0 }, supply: { max: '100', current: '40', decimals: 0 }, max_mint: '1' };
        const sdk = {
            config: { network: 'regtest' },
            _preflightCoalescer: { run: (_key, producer) => producer() },
            explorer: {
                coin: 'BTC',
                getToken: async () => token,
                getPreflight: async () => ({ supported: true, valid: true, status: 'valid' }),
            },
        };
        const report = await engine.runPreflight(sdk, 'MINT|0|EDITION|1', { source: 'bcrt1qsettlecheckfixture' });
        expect(report.verdict).toBe('pass');
        expect(report.unverified.map((u) => u.check)).toEqual(['MINT_ADDRESS_HEADROOM']);
        expect(preflightCheckState(report)).toBe('settleChecks');
    });
});
