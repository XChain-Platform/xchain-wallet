// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { RouteNotFound } from '../../../packages/core/src/shared/routes/RouteNotFound.jsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

afterEach(cleanup);

describe('RouteNotFound', () => {
    it('identifies the missing page and offers a route Home', () => {
        const onHome = vi.fn();
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <RouteNotFound onHome={onHome} />
            </MessagingProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
        expect(onHome).toHaveBeenCalledOnce();
    });

    it('guards the Home fallback in every shell', () => {
        for (const relativePath of [
            'packages/web/src/App.jsx',
            'packages/desktop/renderer/App.jsx',
            'packages/extension/src/popup/App.jsx',
        ]) {
            const source = readFileSync(join(root, relativePath), 'utf8');
            expect(source).toContain("if (unlockedView !== 'home')");
            expect(source).toContain('<RouteNotFound onHome={() => setUnlockedView(\'home\')} />');
        }
    });
});
