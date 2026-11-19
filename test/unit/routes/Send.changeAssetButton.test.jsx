// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send hero's Change asset control is a button, so it carries the shared
// Button base class like every other button in the wallet (UI ruling U07),
// with one variant and one size class. The read-only hero (no change handler)
// stays a plain decorative div outside the button kit.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { SelectedTokenHero } from '../../../packages/core/src/shared/routes/Send.jsx';

afterEach(() => cleanup());

const descriptor = { displayName: 'Bitcoin', nativeTicker: 'BTC', ticker: 'BTC' };

describe('SelectedTokenHero Change asset control', () => {
    it('renders the interactive hero as a shared Button with one variant and one size', () => {
        render(<SelectedTokenHero chainId="bitcoin" tick="BTC" descriptor={descriptor} onChangeAsset={() => {}} />);
        const button = screen.getByRole('button', { name: /^Change asset/ });
        expect(button.tagName).toBe('BUTTON');
        expect(typeof buttonStyles.btn).toBe('string');
        expect(buttonStyles.btn.length).toBeGreaterThan(0);
        expect(button.className.split(/\s+/)).toContain(buttonStyles.btn);
        expect(button.className.split(/\s+/)).toContain(buttonStyles.ghost);
        expect(button.className.split(/\s+/)).toContain(buttonStyles.lg);
    });

    it('calls onChangeAsset on click', () => {
        const onChangeAsset = vi.fn();
        render(<SelectedTokenHero chainId="bitcoin" tick="BTC" descriptor={descriptor} onChangeAsset={onChangeAsset} />);
        fireEvent.click(screen.getByRole('button', { name: /^Change asset/ }));
        expect(onChangeAsset).toHaveBeenCalledTimes(1);
    });

    it('renders the read-only hero as a div without the Button base class', () => {
        const { container } = render(<SelectedTokenHero chainId="bitcoin" tick="BTC" descriptor={descriptor} />);
        expect(screen.queryByRole('button')).toBeNull();
        const hero = container.firstElementChild;
        expect(hero).not.toBeNull();
        expect(hero.tagName).toBe('DIV');
        expect(hero.className.split(/\s+/)).not.toContain(buttonStyles.btn);
    });
});
