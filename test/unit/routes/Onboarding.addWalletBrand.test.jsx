// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';

function draw(props) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Onboarding onCreate={() => {}} onImport={() => {}} onImportFromFreeWallet={() => {}} {...props} />
        </MessagingProvider>,
    );
}

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
    localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());
});

afterEach(() => {
    localStorage.clear();
});

describe('Onboarding wallet choice', () => {
    it('shows the brand block on the first-run screen that has no page header', () => {
        const { container } = draw({});
        const welcomeHeader = container.querySelector('[data-onboarding-welcome-header]');
        expect(welcomeHeader).toBeTruthy();
        expect(welcomeHeader).toContainElement(screen.getByRole('heading', { name: 'XChain Wallet' }));
        expect(welcomeHeader).toContainElement(screen.getByRole('img', { name: 'XChain Wallet' }));
        expect(welcomeHeader).toContainElement(screen.getByText(/open-source, non-custodial wallet/));
        expect(welcomeHeader.children).toHaveLength(2);
    });

    it('drops the brand block under the Add wallet page header so the title and logo are not repeated', () => {
        draw({ onBack: () => {} });
        expect(screen.getByRole('heading', { name: 'Add wallet' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'XChain Wallet' })).toBeNull();
        expect(screen.queryByRole('img', { name: 'XChain Wallet' })).toBeNull();
        expect(screen.queryByText(/open-source, non-custodial wallet/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Create new wallet' })).toBeTruthy();
    });
});
