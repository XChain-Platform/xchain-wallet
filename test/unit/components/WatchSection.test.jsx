// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { selectOption } from '../../helpers/selectOption.js';

let hookState;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => hookState,
}));

const { WatchSection } = await import(
    '../../../packages/core/src/shared/components/settings/WatchSection.jsx'
);

beforeEach(() => {
    hookState = {
        settings: createDefaultSettings(),
        loading: false,
        error: null,
        update: vi.fn().mockResolvedValue(undefined),
    };
});

afterEach(() => cleanup());

describe('WatchSection', () => {
    it('renders the four controls in the ruled order with resolved defaults', () => {
        render(<WatchSection />);

        expect([...document.querySelectorAll('[data-settings-row-title]')].map((node) => node.textContent)).toEqual([
            'Show wallet on watch',
            'Tokens on watch',
            'Start in',
            'Show total on watch face and Tile',
        ]);
        expect(screen.getByRole('switch', { name: 'Show wallet on watch' })).toBeChecked();
        expect(screen.getByRole('switch', { name: 'Show total on watch face and Tile' })).not.toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Tokens on watch' })).toHaveTextContent('Follow Home');
        expect(screen.getByRole('combobox', { name: 'Start in' })).toHaveTextContent('Fiat');
    });

    it('writes each switch and labelled choice through its shared control', () => {
        render(<WatchSection />);

        fireEvent.click(screen.getByRole('switch', { name: 'Show wallet on watch' }));
        selectOption(screen.getByRole('combobox', { name: 'Tokens on watch' }), 'pinned');
        selectOption(screen.getByRole('combobox', { name: 'Start in' }), 'units');
        fireEvent.click(screen.getByRole('switch', { name: 'Show total on watch face and Tile' }));

        expect(hookState.update.mock.calls.map(([patch]) => patch)).toEqual([
            { watch: { enabled: false } },
            { watch: { tokenMode: 'pinned' } },
            { watch: { startIn: 'units' } },
            { watch: { showTotal: true } },
        ]);
    });

    it('renders persisted non-default values', () => {
        hookState.settings.watch = {
            ...hookState.settings.watch,
            enabled: false,
            tokenMode: 'pinned',
            startIn: 'units',
            showTotal: true,
        };
        render(<WatchSection />);

        expect(screen.getByRole('switch', { name: 'Show wallet on watch' })).not.toBeChecked();
        expect(screen.getByRole('combobox', { name: 'Tokens on watch' })).toHaveTextContent('Pinned only');
        expect(screen.getByRole('combobox', { name: 'Start in' })).toHaveTextContent('Units');
        expect(screen.getByRole('switch', { name: 'Show total on watch face and Tile' })).toBeChecked();
    });
});
