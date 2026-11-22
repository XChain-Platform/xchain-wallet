/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The "Could not verify" copy map and the settle-time list both key on check
// ids the SDK emits as string literals, so an id the SDK adds or renames
// drifts silently: an unmapped id draws the generic line, and a renamed
// settle-time id turns the calm settlement note into "partly checked". Both
// are judged here against the ids the installed SDK's source can emit.

import { describe, it, expect } from 'vitest';
import { sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { sdkUnverifiedCheckIds } from '../../helpers/sdkUnverifiedChecks.js';
import { UNVERIFIED_COPY, unverifiedText } from '../../../packages/core/src/shared/utils/preflightFindingCopy.js';
import { SETTLE_TIME_UNVERIFIED_CHECKS } from '../../../packages/core/src/shared/utils/preflightCheckState.js';
import { t } from '../../../packages/core/src/i18n/index.js';

// Call sites and ids the SDK pinned by the shells emits today. A scan that
// finds fewer has stopped reading part of the tree, and an empty scan would
// otherwise pass by iterating nothing.
const MIN_EMIT_SITES = 78;
const MIN_EMITTED_IDS = 63;

describe('"Could not verify" copy <-> xchain-sdk preflight source', () => {
    if (!sdkInstalled()) {
        it('unverified parity guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error('xchain-sdk could not be resolved; this block pins the unverified copy against its source.');
            }
            ctx.skip();
        });
        return;
    }

    const { ids, sites } = sdkUnverifiedCheckIds();

    it('reads every emit site the installed SDK has', () => {
        expect(sites).toBeGreaterThanOrEqual(MIN_EMIT_SITES);
        expect(ids.size).toBeGreaterThanOrEqual(MIN_EMITTED_IDS);
    });

    it('maps every check id the SDK can emit to its own line or, on purpose, the generic one', () => {
        const unmapped = [...ids].filter((id) => !(id in UNVERIFIED_COPY)).sort();
        expect(unmapped).toEqual([]);
    });

    it('keeps every settle-time check an id the SDK still emits', () => {
        const gone = SETTLE_TIME_UNVERIFIED_CHECKS.filter((id) => !ids.has(id));
        expect(gone).toEqual([]);
    });
});

describe('"Could not verify" lines for reads and fees', () => {
    it('says a failed list or dispenser read could not be read', () => {
        for (const check of ['LIST_LOOKUP', 'DISPENSER_LOOKUP', 'ISSUE_CARET_TICK_NO_CREATE']) {
            expect(unverifiedText({ check }).headline, check).toMatch(/couldn't be read/);
        }
    });

    it('keeps the added-days charge for a longer expiration in the duration fee line', () => {
        expect(unverifiedText({ check: 'DURATION_FEE' }).headline).toMatch(/charged for the added days/);
    });

    it('gives each newly mapped id its own line, and an unknown VOTE format the generic one', () => {
        const fallback = t('preflightCopy.unverified.fallback');
        for (const check of ['LIST_LOOKUP', 'DISPENSER_LOOKUP', 'DURATION_FEE', 'DISPENSER_ORIGIN_STANDING',
            'ISSUE_CARET_TICK_NO_CREATE', 'VALIDATOR_SEMANTICS']) {
            expect(unverifiedText({ check }).headline, check).not.toBe(fallback);
        }
        expect(unverifiedText({ check: 'VOTE_UNKNOWN_STATE' }).headline).toBe(fallback);
    });
});
