// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PreflightPanel `restricted` chip contract.
//
// `restricted` means the report covers a proper subset of the checks the
// action warrants (defined beside REPORT_SCHEMA_VERSION in the SDK's
// src/preflight/constants.js). The full SDK preflight always stamps false;
// the wallet's dispenser buy panel (routes/DispenserDetail.jsx) authors a
// funding-only report with restricted: true. Read in isolation, the SDK's
// literal false makes the branch look dead, and until this file the only pin
// on the true branch was a regtest e2e (test/e2e/tests/dispensers/
// buy-funding.regtest.spec.js). These cases hold the chip at unit level so
// neither side can quietly drop or re-purpose it. No SDK import needed.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PreflightPanel }
    from '../../../packages/core/src/shared/components/PreflightPanel.jsx';

afterEach(cleanup);

const reportWith = (verdict, { restricted = false, findings = [] } = {}) => ({
    schemaVersion: 1,
    verdict,
    restricted,
    checksRun: [],
    findings,
    unverified: [],
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

const mount = (report) =>
    render(<PreflightPanel report={report} acknowledged={new Set()} onAcknowledge={() => {}} />);

describe('PreflightPanel restricted chip', () => {
    it('renders "Partial check" when the report is restricted', () => {
        mount(reportWith('pass', { restricted: true }));
        expect(screen.getByTestId('preflight-restricted')).toHaveTextContent('Partial check');
    });

    it('renders the chip on a failing restricted report too (funding-only fail)', () => {
        mount(reportWith('fail', {
            restricted: true,
            findings: [{
                code: 'BALANCE_INSUFFICIENT',
                severity: 'error',
                overridable: false,
                message: 'This buy pays more than this address holds.',
            }],
        }));
        expect(screen.getByTestId('preflight-restricted')).toHaveTextContent('Partial check');
    });

    it('omits the chip when the report is not restricted', () => {
        mount(reportWith('pass'));
        expect(screen.queryByTestId('preflight-restricted')).toBeNull();
    });
});
