// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pin signer copy for info notices outside the Tier-1 family (the SDK trading
// check's own EXPIRY_IN_PAST and GIVE_NOT_BALANCE_MODE), the no-raw-headline
// fallback for an unmapped code, and notice coverage of the whole SDK registry.

import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { requireSdkDeep, resolveSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { PreflightPanel, NOTICE_COPY }
    from '../../../packages/core/src/shared/components/PreflightPanel.jsx';

const preflightConstants = sdkInstalled() ? requireSdkDeep('preflightConstants') : null;

// Same hygiene lines PreflightPanel.findingCopy.test.jsx holds the warning copy to.
const CODE_SHAPED = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\b[A-Z]+_[A-Z]+=/;
const INTERNAL_TERMS = /indexer|activation|\btier\b|dry-?run|server-side|flag[- ]day|feeExempt/i;

afterEach(cleanup);

const reportWith = (findings) => ({
    schemaVersion: 1,
    verdict: 'pass',
    restricted: false,
    checksRun: [],
    findings,
    unverified: [],
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

const mount = (findings) =>
    render(<PreflightPanel report={reportWith(findings)} acknowledged={new Set()} onAcknowledge={() => {}} />);

const info = (code, message, data = {}) => ({ code, severity: 'info', overridable: false, message, data });

// The headline is the first line of the notice; the SDK sentence, when shown, follows it.
const noticeLines = (code) => Array.from(screen.getByTestId(`preflight-notice-${code}`).children)
    .map((el) => el.textContent);

describe('PreflightPanel client info notices', () => {
    it('words an order expiration note for the signer and keeps the SDK sentence as the detail', () => {
        const sdkText = 'Expiration is checked against the chain tip at confirmation time.';
        mount([info('EXPIRY_IN_PAST', sdkText, { expiration: '900000' })]);
        const [headline, detail] = noticeLines('EXPIRY_IN_PAST');
        expect(headline).toMatch(/checks this trade's expiration when the transaction confirms/);
        expect(headline).not.toMatch(/past|expired/i);
        expect(detail).toBe(sdkText);
    });

    it('words both non-balance gives with one headline', () => {
        for (const sdkText of [
            'Ownership trade: no balance check applies.',
            'Native-coin give: settled by outputs, not balances.',
        ]) {
            mount([info('GIVE_NOT_BALANCE_MODE', sdkText)]);
            const [headline, detail] = noticeLines('GIVE_NOT_BALANCE_MODE');
            expect(headline).toBe(NOTICE_COPY.GIVE_NOT_BALANCE_MODE);
            expect(detail).toBe(sdkText);
            cleanup();
        }
    });

    it('never promotes an unmapped info code\'s raw message to the headline', () => {
        mount([info('FUTURE_INFO_CODE', 'raw sdk text')]);
        const notice = screen.getByTestId('preflight-notice-FUTURE_INFO_CODE');
        const [headline, detail] = noticeLines('FUTURE_INFO_CODE');
        expect(headline).not.toContain('raw sdk text');
        expect(detail).toBe('raw sdk text');
        expect(within(notice).getAllByText('raw sdk text')).toHaveLength(1);
    });

    it('keeps every fixed notice line free of code names and internal terms', () => {
        const lines = Object.entries(NOTICE_COPY).filter(([, copy]) => typeof copy === 'string');
        expect(lines.length).toBeGreaterThanOrEqual(4);
        for (const [code, line] of lines) {
            expect(line, code).not.toMatch(CODE_SHAPED);
            expect(line, code).not.toMatch(INTERNAL_TERMS);
        }
    });
});

describe('PreflightPanel notice copy <-> xchain-sdk registry', () => {
    if (preflightConstants === null) {
        it('notice copy guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error('xchain-sdk could not be resolved; this block pins the notice copy keys against its registry.');
            }
            ctx.skip();
        });
        return;
    }

    // Codes the SDK never emits at info without `_downgradedBy`, so the notice
    // list never shows them under their own name: errors and warnings, codes
    // that reach info only through a Tier-1 demotion, and unverified-only codes.
    const NEVER_A_NOTICE = new Set([
        'DRYRUN_INVALID', 'DRYRUN_SUBCOMMAND_INVALID',
        'PARSE_INVALID', 'VALIDATOR_SEMANTICS', 'DEST_ADDRESS_INVALID', 'ENCODING_TOO_LARGE',
        'AMOUNT_FORMAT_INVALID', 'BALANCE_INSUFFICIENT', 'TOKEN_NOT_FOUND', 'NOT_OWNER',
        'SUPPLY_EXCEEDED', 'MINT_OVER_MAX', 'LIST_NOT_FOUND',
        'DISPENSER_NOT_FOUND', 'DISPENSER_NOT_OPEN', 'DISPENSER_TERMS_MISMATCH', 'DISPENSER_EMPTY',
        'NATIVE_FEE_FORFEIT', 'STALE_STATE', 'BATCH_NOT_ATOMIC', 'BATCH_LIMIT_EXCEEDED',
        'TICK_FORMAT', 'AMOUNT_NOT_POSITIVE', 'EMPTY_NO_OP', 'METHOD_NOT_IN_MANIFEST',
        'DISPENSER_LIFECYCLE', 'DISPENSER_NOT_OWNER', 'DISPENSER_MAX_REFILLS',
        'DISPENSER_OWNERSHIP_ESCROW', 'CARET_REF_UNRESOLVABLE', 'DISPENSER_ORACLE_FEE',
    ]);

    it('accounts for every code the SDK registers, so a new one reaches a human', () => {
        const registry = Object.values(preflightConstants.FINDING_CODES);
        expect(registry.length).toBeGreaterThan(20);
        const unaccounted = registry.filter((code) => !(code in NOTICE_COPY) && !NEVER_A_NOTICE.has(code));
        expect(unaccounted).toEqual([]);
        for (const code of [...Object.keys(NOTICE_COPY), ...NEVER_A_NOTICE]) expect(registry, code).toContain(code);
    });

    it('has copy for every code the SDK preflight source emits at info', () => {
        const root = dirname(resolveSdkDeep('preflightConstants').filename);
        const emitted = new Set();
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name);
                if (entry.isDirectory()) { walk(path); continue; }
                if (!entry.name.endsWith('.js')) continue;
                const src = readFileSync(path, 'utf8');
                for (const m of src.matchAll(/addFinding\(FINDING_CODES\.(\w+),\s*'info'/g)) emitted.add(m[1]);
                for (const m of src.matchAll(/code:\s*FINDING_CODES\.(\w+),\s*severity:\s*'info'/g)) emitted.add(m[1]);
            }
        };
        walk(root);
        // An empty scan would pass by iterating nothing; today the SDK emits six.
        expect(emitted.size).toBeGreaterThanOrEqual(6);
        const unmapped = [...emitted].filter((code) => !(code in NOTICE_COPY));
        expect(unmapped).toEqual([]);
    });
});
