// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The scan screen's paste fallback speaks to a person, not a developer: the
// label and button say what to do with plain words, and the strings live in
// the i18n catalog so every shell shows the same text.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, QrScanner: () => null };
});

afterEach(() => cleanup());

describe('ScanRoute paste fallback wording', () => {
    it('keeps one main landmark when rendered inside the app screen', () => {
        render(
            <main>
                <ScanRoute embedded onClassified={vi.fn()} onBack={vi.fn()} />
            </main>,
        );

        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(screen.getByRole('region', { name: 'Scan' })).toBeInTheDocument();
    });

    it('labels the paste box and button in plain words', () => {
        render(<ScanRoute onClassified={vi.fn()} onBack={vi.fn()} />);
        expect(screen.getByText('Or paste it here')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Use pasted text' })).toBeInTheDocument();
        expect(screen.queryByText(/payload/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /classify/i })).toBeNull();
    });
});
