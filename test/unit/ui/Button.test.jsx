// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../packages/core/src/ui/Button.jsx';
import { SendIcon } from '../../../packages/core/src/ui/icons/index.jsx';

describe('<Button>', () => {
    it('renders children as label', () => {
        render(<Button>Submit</Button>);
        expect(screen.getByRole('button')).toHaveTextContent('Submit');
    });

    it('fires onClick', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Go</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('loading implies disabled and aria-busy', () => {
        render(<Button loading>Signing</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    it('explicit disabled works independently of loading', () => {
        render(<Button disabled>Stopped</Button>);
        expect(screen.getByRole('button')).toBeDisabled();
    });

    it('type defaults to button (no accidental form submits)', () => {
        render(<Button>Harmless</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('submits via type=submit when set', () => {
        render(<Button type="submit">Confirm</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });

    it('forwards arbitrary props like aria-label', () => {
        render(<Button aria-label="Advance">→</Button>);
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Advance');
    });

    it('uses the shared size scale and hides decorative icons', () => {
        render(<Button size="sm" icon={<SendIcon />}>Send</Button>);
        const icon = screen.getByRole('button').querySelector('svg');
        const css = readFileSync('packages/core/src/ui/Button.module.css', 'utf8');

        expect(icon).toHaveAttribute('width', 'var(--xc-icon-size, var(--xc-icon-md))');
        expect(icon).toHaveAttribute('height', 'var(--xc-icon-size, var(--xc-icon-md))');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(css).toMatch(/\.sm\s*\{[^}]*--xc-icon-size:\s*var\(--xc-icon-sm\)/s);
        expect(css).toMatch(/\.md\s*\{[^}]*--xc-icon-size:\s*var\(--xc-icon-md\)/s);
    });
});
