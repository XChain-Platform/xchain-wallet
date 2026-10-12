// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PreflightPanel signer copy for warnings and the "Could not verify" list
// (§5.2.4). The SDK writes both in wire field names and protocol terms for a
// report reader; the panel must lead with a plain line for the person about to
// sign and keep the SDK's own sentence beneath it as the detail.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';
import {
    UNVERIFIED_COPY,
    WARNING_COPY,
    unverifiedText,
    warningText,
} from '../../../packages/core/src/shared/utils/preflightFindingCopy.js';

const preflightConstants = sdkInstalled() ? requireSdkDeep('preflightConstants') : null;

afterEach(cleanup);

const reportWith = ({ verdict = 'warn', findings = [], unverified = [] } = {}) => ({
    schemaVersion: 1,
    verdict,
    restricted: false,
    checksRun: [],
    findings,
    unverified,
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

const mount = (report) =>
    render(<PreflightPanel report={report} acknowledged={new Set()} onAcknowledge={() => {}} />);

// Wire field names and code names, read case-sensitively.
const CODE_SHAPED = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\b[A-Z]+_[A-Z]+=/;
// Terms only someone who knows the protocol internals can read.
const INTERNAL_TERMS = /indexer|activation|\btier\b|dry-?run|server-side|flag[- ]day|feeExempt/i;

// The sentence amount_rules.js writes for a balance dispenser created with no
// give amount, verbatim.
const DISPENSER_GIVE_AMOUNT = {
    code: 'AMOUNT_NOT_POSITIVE',
    severity: 'warning',
    source: 'client',
    message: 'GIVE_AMOUNT is required and must be greater than 0 for a balance dispenser '
        + '(GIVE_OWNERSHIP=0); at or above the activation the indexer rejects this create, '
        + 'and below it the dispenser opens but credits nothing while absorbing payments.',
    data: { giveAmount: null, giveOwnership: '0' },
};

describe('PreflightPanel warning copy (§5.2.4)', () => {
    it('leads a warning with plain copy and keeps the SDK sentence as the detail', () => {
        mount(reportWith({ findings: [DISPENSER_GIVE_AMOUNT] }));
        const row = screen.getByTestId('preflight-warning-AMOUNT_NOT_POSITIVE');
        const [headline, detail] = row.querySelectorAll('span');
        expect(headline.textContent).toBe(WARNING_COPY.AMOUNT_NOT_POSITIVE);
        expect(headline.textContent).not.toMatch(CODE_SHAPED);
        expect(headline.textContent).not.toMatch(INTERNAL_TERMS);
        expect(detail.textContent).toBe(DISPENSER_GIVE_AMOUNT.message);
    });

    it('keys the not-owner warning on the wire value the finding carries', () => {
        mount(reportWith({ findings: [{
            code: 'DISPENSER_NOT_OWNER', severity: 'warning', source: 'client',
            message: 'Source is neither the dispenser owner (bc1qowner) nor its GET_ADDRESS; the chain will reject this.',
            data: {},
        }] }));
        const row = screen.getByTestId('preflight-warning-DISPENSER_NOT_OWNER');
        expect(within(row).getByText(WARNING_COPY.DISPENSER_NOT_OWNER)).toBeTruthy();
    });

    it('never promotes an unmapped warning message to the headline', () => {
        const f = { code: 'SOME_FUTURE_CODE', severity: 'warning', message: 'FUTURE_FIELD=1 is not supported yet.' };
        mount(reportWith({ findings: [f] }));
        const [headline, detail] = screen.getByTestId('preflight-warning-SOME_FUTURE_CODE').querySelectorAll('span');
        expect(headline.textContent).not.toContain('FUTURE_FIELD');
        expect(detail.textContent).toBe(f.message);
    });

    // Tier 1 demotes a balance error to a warning when the network accepted the
    // action and only a projection over other unconfirmed actions still flags
    // it; copy keyed on the code alone would contradict that acceptance.
    it('does not contradict a network acceptance on a locally demoted balance warning', () => {
        const { headline } = warningText({
            code: 'BALANCE_INSUFFICIENT', severity: 'warning', source: 'client',
            _downgradedBy: 'dryrun-valid-local-delta',
            message: 'Insufficient JDOG balance: have 5, need 9 after pending.',
        });
        expect(headline).toMatch(/network accepted/i);
        expect(headline).not.toBe(WARNING_COPY.BALANCE_INSUFFICIENT);
    });

    // The SDK keeps these as warnings because the rule binds only past an
    // activation height pre-flight cannot read, so the network may still accept.
    it('words a height-gated rule as a possible rejection, never a certain one', () => {
        const gated = ['AMOUNT_NOT_POSITIVE', 'AMOUNT_FORMAT_INVALID', 'BATCH_LIMIT_EXCEEDED',
            'CARET_REF_UNRESOLVABLE', 'DISPENSER_OWNERSHIP_ESCROW', 'TICK_FORMAT'];
        for (const code of gated) {
            expect(WARNING_COPY[code], code).toMatch(/\bmay\b/);
            expect(WARNING_COPY[code], code).not.toMatch(/\bwill\b|\brejects\b|\bis rejected\b|\bcannot resolve\b/);
        }
    });

    it('keeps a zero dispenser price and the coin it can cost in the headline', () => {
        const { headline, detail } = warningText({
            code: 'AMOUNT_NOT_POSITIVE', severity: 'warning', source: 'client',
            message: 'Dispenser #3 prices at GET_AMOUNT 0, which is not a positive amount; '
                + 'at or above the activation every dispense against it is rejected at settlement, '
                + 'AFTER your native coin moves.',
        });
        expect(headline).toMatch(/price it pays against/);
        expect(headline).toMatch(/coin you send with it may not come back/);
        expect(headline).not.toMatch(/amount in this action/i);
        expect(detail).toMatch(/AFTER your native coin moves/);
    });

    it('writes every mapped warning headline without code names or internal terms', () => {
        const entries = Object.entries(WARNING_COPY);
        expect(entries.length).toBeGreaterThan(5);
        for (const [code, line] of entries) {
            expect(line, code).not.toMatch(CODE_SHAPED);
            expect(line, code).not.toMatch(INTERNAL_TERMS);
        }
    });
});

describe('PreflightPanel "Could not verify" copy (§5.2.4)', () => {
    it('names what was not checked and keeps the SDK note as the detail', () => {
        const note = 'obligation existence/match/expiry resolve server-side; Tier 1 gives NO verdict (feeExempt)';
        mount(reportWith({ verdict: 'pass', unverified: [{ check: 'COINPAY_STATE', reason: note }] }));
        const [headline, detail] = screen.getByTestId('preflight-unverified-COINPAY_STATE').querySelectorAll('span');
        expect(headline.textContent).toBe(UNVERIFIED_COPY.COINPAY_STATE);
        expect(headline.textContent).not.toMatch(INTERNAL_TERMS);
        expect(detail.textContent).toBe(note);
    });

    it('keeps the fee a failed contract call still charges in the headline', () => {
        expect(unverifiedText({ check: 'EXECUTE_STATE', reason: 'x' }).headline).toMatch(/still charges its fee/);
    });

    it('falls back to an honest generic line for an unmapped check', () => {
        const { headline, detail } = unverifiedText({
            check: 'NEW_ACTION_STATE', reason: 'no client-side state checks are certified for this action',
        });
        expect(headline).not.toMatch(INTERNAL_TERMS);
        expect(detail).toBe('no client-side state checks are certified for this action');
    });

    it('keeps the wallet\'s own dispenser note as the headline', () => {
        const reason = 'Only your payment-token balance was checked. The dispenser can still close or sell out before your payment confirms.';
        expect(unverifiedText({ check: 'dispenser_state', reason })).toEqual({ headline: reason, detail: null });
    });

    it('writes every mapped check headline without code names or internal terms', () => {
        const entries = Object.entries(UNVERIFIED_COPY);
        expect(entries.length).toBeGreaterThan(20);
        for (const [check, line] of entries) {
            expect(line, check).not.toMatch(CODE_SHAPED);
            expect(line, check).not.toMatch(INTERNAL_TERMS);
        }
    });
});

describe('PreflightPanel warning copy <-> xchain-sdk registry', () => {
    if (preflightConstants === null) {
        it('warning copy guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error('xchain-sdk could not be resolved; this block pins the warning copy keys against its registry.');
            }
            ctx.skip();
        });
        return;
    }

    // Codes that never reach the warnings list under their own name. The
    // Tier-2 error codes reach it only through the local-delta demotion, which
    // has its own headline; the rest are info-only, unverified-only, emitted
    // by nothing, or free-form validator text that takes the generic line.
    const NEVER_A_NAMED_WARNING = new Set([
        'PARSE_INVALID', 'DEST_ADDRESS_INVALID', 'ENCODING_TOO_LARGE', 'TOKEN_NOT_FOUND',
        'NOT_OWNER', 'SUPPLY_EXCEEDED', 'MINT_OVER_MAX', 'LIST_NOT_FOUND',
        'DISPENSER_NOT_FOUND', 'DISPENSER_NOT_OPEN', 'DISPENSER_TERMS_MISMATCH', 'DISPENSER_EMPTY',
        'EXPIRY_IN_PAST', 'GIVE_NOT_BALANCE_MODE',
        'DISPENSER_MAX_REFILLS', 'DISPENSER_ORACLE_FEE',
        'STALE_STATE', 'EMPTY_NO_OP', 'METHOD_NOT_IN_MANIFEST',
        'VALIDATOR_SEMANTICS',
    ]);

    it('maps only codes the SDK registers', () => {
        const registry = Object.values(preflightConstants.FINDING_CODES);
        for (const code of Object.keys(WARNING_COPY)) expect(registry, code).toContain(code);
    });

    it('accounts for every code the SDK registers', () => {
        const registry = Object.values(preflightConstants.FINDING_CODES)
            .filter((code) => !code.startsWith('DRYRUN_'));
        expect(registry.length).toBeGreaterThan(20);
        const unaccounted = registry.filter((code) => !(code in WARNING_COPY) && !NEVER_A_NAMED_WARNING.has(code));
        expect(unaccounted).toEqual([]);
    });
});
