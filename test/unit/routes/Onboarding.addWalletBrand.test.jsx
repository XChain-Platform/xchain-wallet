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
    it('shows only the logo and exact tagline while keeping an accessible page heading', () => {
        const { container } = draw({});
        const welcomeHeader = container.querySelector('[data-onboarding-welcome-header]');
        expect(welcomeHeader).toBeTruthy();
        const title = screen.getByRole('heading', { name: 'XChain Wallet', hidden: true });
        expect(title).toHaveClass('sr-only');
        expect(title.className).not.toContain('welcomeTitle');
        expect(welcomeHeader).toContainElement(title);
        // No app header on the welcome page: the big logo in the body is the
        // only logo, and there is no menu button.
        expect(container.querySelectorAll('img[src]:not([alt=""])')).toHaveLength(0);
        expect(container.querySelector('[role="region"] img')).toBeNull();
        expect(screen.queryByRole('button', { name: /open menu/i })).toBeNull();
        // Logo and tagline are the only visible hero content above the buttons.
        const logo = welcomeHeader.querySelector('[data-onboarding-welcome-logo]');
        const tagline = screen.getByText('Multi-chain wallet for the XChain platform.');
        expect(logo).toBeTruthy();
        expect(welcomeHeader).toContainElement(tagline);
        expect(logo.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(title.compareDocumentPosition(tagline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const create = screen.getByRole('button', { name: 'Create New Wallet' });
        expect(tagline.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Header, logo, tagline and buttons share one centred form.
        expect(create.closest('form').className).toContain('welcomeForm');
    });

    it('drops the brand block under the Add wallet page header so the title and logo are not repeated', () => {
        draw({ onBack: () => {} });
        expect(screen.getByRole('heading', { name: 'Add Wallet' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'XChain Wallet', hidden: true })).toBeNull();
        expect(screen.queryByRole('img', { name: 'XChain Wallet' })).toBeNull();
        expect(screen.queryByText('Multi-chain wallet for the XChain platform.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Create New Wallet' })).toBeTruthy();
    });
});
