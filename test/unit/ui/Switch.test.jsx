// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from '../../../packages/core/src/ui/Switch.jsx';

function ControlledSwitch() {
    const [checked, setChecked] = useState(false);
    return (
        <Switch
            label="Hide small balances"
            description="Collapse balances below the selected threshold."
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
        />
    );
}

describe('<Switch>', () => {
    it('uses native checkbox behavior with switch state and linked copy', () => {
        render(<ControlledSwitch />);

        const control = screen.getByRole('switch', { name: 'Hide small balances' });
        const descriptionId = control.getAttribute('aria-describedby');
        expect(control).toHaveAttribute('type', 'checkbox');
        expect(control).toHaveAttribute('aria-checked', 'false');
        expect(document.getElementById(descriptionId)).toHaveTextContent(
            'Collapse balances below the selected threshold.',
        );

        fireEvent.click(screen.getByText('Hide small balances'));
        expect(control).toBeChecked();
        expect(control).toHaveAttribute('aria-checked', 'true');
    });

    it('keeps a disabled switch inert', () => {
        const onChange = vi.fn();
        render(
            <Switch
                label="Unavailable setting"
                checked
                disabled
                onChange={onChange}
            />,
        );

        const control = screen.getByRole('switch', { name: 'Unavailable setting' });
        expect(control).toBeDisabled();
        expect(control).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(control);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('uses control geometry, a 44px hit area, and semantic state tokens', () => {
        const css = readFileSync('packages/core/src/ui/Switch.module.css', 'utf8');

        expect(css).toMatch(/--xc-switch-hit-size:\s*44px/);
        expect(css).toMatch(/--xc-switch-track-width:\s*var\(--xc-control-h-md\)/);
        expect(css).toMatch(/--xc-switch-track-height:\s*calc\(var\(--xc-control-h-sm\)/);
        expect(css).toMatch(/\.input:focus-visible \+ \.track\s*{[^}]*var\(--xc-control-focus-ring\)/s);
        expect(css).toMatch(/\.input:disabled \+ \.track\s*{[^}]*var\(--xc-control-disabled-border\)/s);
        expect(css).toMatch(/\.input:checked \+ \.track\s*{[^}]*var\(--xc-control-selected\)/s);
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });

    it('makes the input itself fill the 44px hit area, not only its label', () => {
        const css = readFileSync('packages/core/src/ui/Switch.module.css', 'utf8');
        const input = css.match(/\.input\s*\{([^}]*)\}/s)[1];

        // A touch audit measures the control element; the track-sized input
        // read as 44x28 even though the label around it took the tap.
        expect(input).toMatch(/inset:\s*0/);
        expect(input).toMatch(/width:\s*100%/);
        expect(input).toMatch(/height:\s*100%/);
        expect(css).toMatch(/\.hitArea\s*\{[^}]*width:\s*var\(--xc-switch-hit-size\)[^}]*height:\s*var\(--xc-switch-hit-size\)/s);
    });

    it('is exported and has canonical style-guide guidance and examples', () => {
        const uiIndex = readFileSync('packages/core/src/ui/index.js', 'utf8');
        const guide = readFileSync('packages/web/src/style-guide/StyleGuidePage.jsx', 'utf8');
        const section = readFileSync(
            'packages/web/src/style-guide/sections/SwitchSection.jsx',
            'utf8',
        );

        expect(uiIndex).toContain("export { Switch } from './Switch.jsx';");
        expect(guide).toMatch(/id: 'switch'.*primitives: \['Switch'\]/);
        expect(section).toContain('<Guidance');
        expect(section).toContain('<Markup>');
        expect(section).toContain('<LiveExample');
    });
});
