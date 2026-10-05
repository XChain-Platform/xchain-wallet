// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Approve gate must hold on a whole-report fail verdict even when the
// report carries no findings entry to key the block on (the shape a
// hand-rolled dry-run fixture produces).

import { describe, it, expect } from 'vitest';
import { canApproveWithReport } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const hardError = {
    code: 'DEST_ADDRESS_INVALID',
    severity: 'error',
    overridable: false,
    message: 'bad address',
};

const overridableError = {
    code: 'DRYRUN_INVALID',
    severity: 'error',
    overridable: true,
    message: 'network says no',
};

describe('canApproveWithReport dry-run fail verdict', () => {
    it('blocks on a non-overridable error finding', () => {
        const report = { verdict: 'fail', findings: [hardError] };
        expect(canApproveWithReport(report, new Set())).toBe(false);
    });

    it('blocks on a fail verdict with an empty findings array', () => {
        expect(canApproveWithReport({ findings: [], verdict: 'fail' }, new Set())).toBe(false);
    });

    it('blocks on a fail verdict with no findings array', () => {
        expect(canApproveWithReport({ verdict: 'fail' }, new Set())).toBe(false);
    });

    it('still allows an acknowledged overridable fail', () => {
        const report = { verdict: 'fail', findings: [overridableError] };
        expect(canApproveWithReport(report, new Set(['DRYRUN_INVALID']))).toBe(true);
    });

    it('allows a passing report', () => {
        expect(canApproveWithReport({ verdict: 'pass', findings: [] }, new Set())).toBe(true);
    });
});
