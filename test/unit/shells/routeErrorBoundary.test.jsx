// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShellRouteOutlet } from '../../../packages/core/src/shared/components/ShellRouteOutlet.jsx';
import webAppSource from '../../../packages/web/src/App.jsx?raw';
import popupAppSource from '../../../packages/extension/src/popup/App.jsx?raw';
import desktopAppSource from '../../../packages/desktop/renderer/App.jsx?raw';

const SHELLS = [
    ['web', webAppSource],
    ['extension popup', popupAppSource],
    ['desktop renderer', desktopAppSource],
];

const preventExpectedError = (event) => event.preventDefault();

function ThrowingRoute() {
    throw new Error('route render failed');
}

function ShellHarness({ shell }) {
    const [route, setRoute] = useState('broken');
    return (
        <div>
            <nav aria-label={`${shell} shell`}>Wallet navigation</nav>
            <ShellRouteOutlet routeKey={route} onHome={() => setRoute('home')}>
                {route === 'broken' ? <ThrowingRoute /> : <h1>Wallet Home</h1>}
            </ShellRouteOutlet>
        </div>
    );
}

beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', preventExpectedError);
});

afterEach(() => {
    cleanup();
    window.removeEventListener('error', preventExpectedError);
    vi.restoreAllMocks();
});

describe.each(SHELLS)('%s route outlet', (shell, source) => {
    it('contains a render error without blanking the shell', () => {
        expect(source).toContain('<ShellRouteOutlet');

        render(<ShellHarness shell={shell} />);

        expect(screen.getByRole('navigation', { name: `${shell} shell` })).toBeTruthy();
        expect(screen.getByText(/Something went wrong while showing this screen/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));

        expect(screen.getByRole('heading', { name: 'Wallet Home' })).toBeTruthy();
        expect(screen.getByRole('navigation', { name: `${shell} shell` })).toBeTruthy();
    });
});
