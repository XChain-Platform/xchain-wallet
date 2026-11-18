// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A form opened from a token's own page hands over its token (formSource
// 'token-detail' or 'manage-token'). Opening Issue token from the command
// palette afterwards used to start on the Subtoken template with that token
// as parent, because only the menu cleared the source. Every root open, the
// palette and go-to shortcuts included, now clears it through one helper in
// all three shells.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { createRootViewOpener } from '../../../packages/core/src/shared/rootViewOpener.js';
import { useCommandPalette } from '../../../packages/core/src/shared/commandPalette/useCommandPalette.js';

function useShell() {
    const [view, setView] = useState('token-detail');
    const [formSource, setFormSource] = useState('token-detail');
    const [picker, setPicker] = useState('shared-block');
    const openRootView = createRootViewOpener(setView, () => {
        setFormSource(null);
        setPicker(null);
    });
    const palette = useCommandPalette({ navigate: openRootView, currentView: view });
    return { view, formSource, picker, palette, openRootView };
}

describe('root navigation clears the form source token', () => {
    it('palette navigation to Issue token drops the token a token-page form left behind', () => {
        const { result } = renderHook(() => useShell());
        expect(result.current.formSource).toBe('token-detail');
        act(() => result.current.palette.navigate('wizard'));
        expect(result.current.view).toBe('wizard');
        expect(result.current.formSource).toBeNull();
        expect(result.current.picker).toBeNull();
    });

    it('a go-to shortcut or menu pick (the opener itself) clears it too', () => {
        const { result } = renderHook(() => useShell());
        act(() => result.current.openRootView('mint'));
        expect(result.current.view).toBe('mint');
        expect(result.current.formSource).toBeNull();
    });
});

const SHELLS = [
    ['web', 'packages/web/src/App.jsx'],
    ['desktop', 'packages/desktop/renderer/App.jsx'],
    ['extension', 'packages/extension/src/popup/App.jsx'],
];

describe.each(SHELLS)('%s shell wiring', (_name, file) => {
    const src = readFileSync(join(__dirname, '../../..', file), 'utf8');

    it('builds openRootView from the shared helper and clears both source states', () => {
        const m = src.match(/const openRootView = createRootViewOpener\(nav\.navigateRoot, \(\) => \{([\s\S]*?)\}\);/);
        expect(m).not.toBeNull();
        expect(m[1]).toContain('setFormSource(null)');
        expect(m[1]).toContain('setTokenAdminInitialPicker(null)');
    });

    it('routes the palette and the go-to shortcuts through it, never the raw navigator', () => {
        expect(src).not.toMatch(/const openRootView = nav\.navigateRoot/);
        expect(src).toMatch(/useCommandPalette\(\{[\s\S]*?navigate: openRootView,/);
        expect(src).toMatch(/useKeyboardShortcuts\(\{[\s\S]*?navigate: openRootView,/);
    });
});
