// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { __createDevMockSdkForTests } from '../../../packages/web/src/hostBridge.js';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';
import { canApproveWithReport, toggleAcknowledged } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

afterEach(cleanup);

const CHAINS = [
    ['BTC', 'bitcoin-mainnet'],
    ['LTC', 'litecoin-mainnet'],
    ['DOGE', 'dogecoin-mainnet'],
    ['BTC', 'bitcoin-regtest'],
    ['LTC', 'litecoin-regtest'],
    ['DOGE', 'dogecoin-regtest'],
];

describe.each(CHAINS)('dev mock preflight for %s on %s', (ticker, network) => {
    const open = async () => {
        const sdk = __createDevMockSdkForTests({ network });
        const source = await sdk.wallet.deriveAddress(`02${'11'.repeat(32)}`);
        return { sdk, source };
    };

    it('passes a native payment the wallet can afford', async () => {
        const { sdk, source } = await open();
        const report = await sdk.preflight(`SEND|0|${ticker}|1|dest`, { source });
        expect(report.verdict).toBe('pass');
        expect(canApproveWithReport(report, new Set())).toBe(true);
    });

    it('fails an unaffordable native payment with an overridable finding', async () => {
        const { sdk, source } = await open();
        const report = await sdk.preflight(`SEND|0|${ticker}|999999999999|dest`, { source });
        expect(report.verdict).toBe('fail');
        const finding = report.findings.find((f) => f.code === 'BALANCE_INSUFFICIENT');
        expect(finding).toMatchObject({ severity: 'error', overridable: true });
        expect(canApproveWithReport(report, new Set())).toBe(false);
    });

    it('offers Sign anyway for the finding and lets Approve proceed once acknowledged', async () => {
        const { sdk, source } = await open();
        const report = await sdk.preflight(`SEND|0|${ticker}|999999999999|dest`, { source });
        let acknowledged = new Set();
        const view = (set) => (
            <PreflightPanel
                report={report}
                acknowledged={set}
                onAcknowledge={(key) => { acknowledged = toggleAcknowledged(acknowledged, key); }}
            />
        );
        const { rerender } = render(view(acknowledged));
        expect(screen.getByText('Sign anyway')).toBeTruthy();
        fireEvent.click(screen.getByTestId('ack-BALANCE_INSUFFICIENT'));
        rerender(view(acknowledged));
        expect(canApproveWithReport(report, acknowledged)).toBe(true);
    });
});
