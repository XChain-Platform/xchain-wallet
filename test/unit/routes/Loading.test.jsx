// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Loading } from '../../../packages/core/src/shared/routes/Loading.jsx';

afterEach(cleanup);

function renderLoading(props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={{}}>
            <Loading {...props} />
        </MessagingProvider>,
    );
}

describe('Loading error recovery', () => {
    it('shows plain recovery copy without rendering the raw error object', () => {
        const error = new Error('database password and internal path');
        renderLoading({ error });

        expect(screen.getByRole('heading', { name: /wallet could not start/i })).toBeTruthy();
        expect(screen.getByText(/choose try again.*contact support/i)).toBeTruthy();
        expect(screen.queryByText(/database password/i)).toBeNull();
        expect(screen.queryByText(/internal path/i)).toBeNull();
    });

    it('calls the retry action when Try again is chosen', () => {
        const onRetry = vi.fn();
        renderLoading({ error: 'raw startup failure', onRetry });

        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(onRetry).toHaveBeenCalledTimes(1);
    });
});

describe('Recovery screen phone layouts', () => {
    it('keeps the loading error panel within the available 360px width', () => {
        const loadingCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/Loading.module.css'),
            'utf8',
        );
        const panel = loadingCss.match(/\.errorPanel\s*\{[^}]*\}/)[0];

        expect(panel).toMatch(/width:\s*100%/);
        expect(panel).toMatch(/min-width:\s*0/);
        expect(panel).toMatch(/max-width:\s*480px/);
        expect(panel).toMatch(/box-sizing:\s*border-box/);
    });

    it('lets vault recovery copy and actions wrap within 360px', () => {
        const vaultCss = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/VaultUnavailable.module.css'),
            'utf8',
        );
        const wrap = vaultCss.match(/\.wrap\s*\{[^}]*\}/)[0];
        const restoreAction = vaultCss.match(/\.escapeLink\s*\{[^}]*\}/)[0];

        expect(wrap).toMatch(/width:\s*100%/);
        expect(wrap).toMatch(/min-width:\s*0/);
        expect(wrap).toMatch(/max-width:\s*100%/);
        expect(wrap).toMatch(/overflow-wrap:\s*anywhere/);
        expect(restoreAction).toMatch(/max-width:\s*100%/);
        expect(restoreAction).toMatch(/white-space:\s*normal/);
    });
});
