// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

function renderOnboarding() {
    return render(
        <MessagingContext.Provider value={{ shell: 'web', messaging: {} }}>
            <Onboarding onCreate={() => {}} onImport={() => {}} />
        </MessagingContext.Provider>,
    );
}

function acceptLicense() {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
}

beforeEach(() => {
    localStorage.clear();
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    delete globalThis.matchMedia;
});

describe('Onboarding route accessibility', () => {
    it('scans the license gate', async () => {
        const { container } = renderOnboarding();
        await screen.findByLabelText('License terms');
        await expectNoSeriousAxeViolations(container);
    });

    it('scans every explainer step and the welcome choice', async () => {
        acceptLicense();
        const { container } = renderOnboarding();
        await screen.findByText('You hold the keys');
        await expectNoSeriousAxeViolations(container);

        for (const title of [
            'Your recovery phrase is everything',
            'Sending is final',
            'Built for the XChain Platform',
        ]) {
            fireEvent.click(screen.getByRole('button', { name: 'Next' }));
            await screen.findByText(title);
            await expectNoSeriousAxeViolations(container);
        }

        fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
        await screen.findByRole('button', { name: 'Create new wallet' });
        await expectNoSeriousAxeViolations(container);
    });
});
