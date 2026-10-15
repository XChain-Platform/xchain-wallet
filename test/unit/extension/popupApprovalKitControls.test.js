// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChoiceControl } from '../../../packages/core/src/ui/ChoiceControl.jsx';

const sourceDirectories = [
    'packages/extension/src/popup',
    'packages/extension/src/approval',
];
const nativeControlPattern = /<(?:button|input|select|textarea)\b/;

function jsxFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return jsxFiles(path);
        if (!entry.name.endsWith('.jsx')) return [];
        return [path];
    });
}

describe('extension popup and approval kit controls', () => {
    const files = sourceDirectories.flatMap((directory) => jsxFiles(resolve(directory)));

    it.each(files)('%s has no hand-rolled form controls', (file) => {
        const source = readFileSync(file, 'utf8');

        expect(source).not.toMatch(nativeControlPattern);
    });

    it.each(['button', 'input', 'select', 'textarea'])('rejects a native %s control', (tag) => {
        expect(`<${tag} aria-label="fixture" />`).toMatch(nativeControlPattern);
    });

    it('renders shared choice controls with preserved labels and native state', () => {
        const onChange = vi.fn();
        render(createElement(
            ChoiceControl,
            { checked: false, onChange, 'data-testid': 'approval-choice' },
            'Share Primary account',
        ));

        const choice = screen.getByRole('checkbox', { name: 'Share Primary account' });
        expect(choice).toHaveAttribute('data-testid', 'approval-choice');
        expect(choice.closest('label')).toBeInTheDocument();

        fireEvent.click(choice);
        expect(onChange).toHaveBeenCalledOnce();
        cleanup();
    });

    it('sizes shared choice controls entirely from kit tokens', () => {
        const source = readFileSync(
            resolve('packages/core/src/ui/ChoiceControl.module.css'),
            'utf8',
        );

        expect(source).toMatch(/min-height:\s*var\(--xc-control-h-md\)/);
        expect(source).toMatch(/gap:\s*var\(--xc-space-2\)/);
        expect(source).toMatch(/width:\s*var\(--xc-icon-md\)/);
        expect(source).not.toMatch(/:\s*\d+(?:\.\d+)?(?:px|rem)\b/);
    });

    it('loads the shared popup surface styles in the side panel', () => {
        const popup = readFileSync(resolve('packages/extension/popup.html'), 'utf8');
        const sidePanel = readFileSync(resolve('packages/extension/sidepanel.html'), 'utf8');
        const stylesheet = '<link rel="stylesheet" href="./src/popup/popup.css" />';

        expect(popup).toContain(stylesheet);
        expect(sidePanel).toContain(stylesheet);
    });

    it('renders the popup recovery action with the core Button', () => {
        const source = readFileSync(
            resolve('packages/extension/src/popup/backgroundConnection.jsx'),
            'utf8',
        );

        expect(source).toMatch(/import \{ Button \} from '@xchain-wallet\/core\/ui'/);
        expect(source).toMatch(/<Button\b[^>]*\bonClick=\{reload\}/);
    });
});
