// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouteErrorBoundary } from '../../../packages/core/src/shared/components/RouteErrorBoundary.jsx';

let consoleError;
const preventExpectedError = (event) => event.preventDefault();

beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener('error', preventExpectedError);
});

afterEach(() => {
    cleanup();
    window.removeEventListener('error', preventExpectedError);
    consoleError.mockRestore();
});

function ThrowingRoute() {
    throw new Error('route render failed');
}

function TransientRoute({ shouldFail }) {
    if (shouldFail()) throw new Error('private render details');
    return <h1>Recovered route</h1>;
}

function TestRouter() {
    const [route, setRoute] = useState('broken');
    return (
        <div data-testid="session-provider">
            <RouteErrorBoundary resetKey={route} onHome={() => setRoute('home')}>
                {route === 'broken' ? <ThrowingRoute /> : <h1>Wallet Home</h1>}
            </RouteErrorBoundary>
        </div>
    );
}

describe('RouteErrorBoundary', () => {
    it('replaces a throwing route and returns Home without unmounting the session', async () => {
        render(<TestRouter />);

        expect(screen.getByRole('heading', { name: 'This screen could not be shown' })).toBeTruthy();
        expect(screen.getByText(/without locking your wallet/i)).toBeTruthy();
        expect(screen.getByTestId('session-provider')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));

        await waitFor(() => expect(screen.getByRole('heading', { name: 'Wallet Home' })).toBeTruthy());
        expect(screen.getByTestId('session-provider')).toBeTruthy();
    });

    it('offers reload when there is no Home route', () => {
        const onReload = vi.fn();
        render(
            <RouteErrorBoundary onReload={onReload}>
                <ThrowingRoute />
            </RouteErrorBoundary>,
        );

        expect(screen.queryByRole('button', { name: 'Back to Home' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
        expect(onReload).toHaveBeenCalledOnce();
    });

    it('retries a render without exposing the error or stack trace', async () => {
        let failed = true;
        const stackMarker = 'secret/component/file.jsx:42';
        function FailingRoute() {
            if (failed) {
                const error = new Error('private render details');
                error.stack = stackMarker;
                throw error;
            }
            return <TransientRoute shouldFail={() => false} />;
        }

        render(
            <RouteErrorBoundary onRetry={() => { failed = false; }}>
                <FailingRoute />
            </RouteErrorBoundary>,
        );

        expect(screen.queryByText('private render details')).toBeNull();
        expect(screen.queryByText(stackMarker)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Recovered route' })).toBeTruthy());
    });

    it('renders compact failures without full-screen recovery actions', () => {
        render(
            <RouteErrorBoundary variant="compact">
                <ThrowingRoute />
            </RouteErrorBoundary>,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('Could not load this section.');
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'This screen could not be shown' })).toBeNull();
    });
});
