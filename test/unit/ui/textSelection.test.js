// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), 'utf8');

function declarations(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
}

function expectSelection(css, selector, value) {
    const body = declarations(css, selector);
    expect(body, selector).toContain(`-webkit-user-select: ${value}`);
    expect(body, selector).toContain(`user-select: ${value}`);
}

describe('text selection contract', () => {
    it('keeps controls and decorative icons out of long-press selections', () => {
        const css = read('packages/core/src/ui/tokens.css');
        expectSelection(css, ":where(button, [role='button'], [role='tab']),\n:where(svg, [aria-hidden='true'])", 'none');
    });

    it('keeps wallet identifiers and values selectable inside clickable rows', () => {
        expectSelection(
            read('packages/core/src/ui/tokens.css'),
            ':where(code, samp, output, address)',
            'text',
        );
        expectSelection(read('packages/core/src/ui/AddressText.module.css'), '.addr', 'text');
        expectSelection(read('packages/core/src/shared/components/BalanceList.module.css'), '.amounts', 'text');
        expectSelection(read('packages/core/src/shared/routes/AddressList.module.css'), '.addrLine2', 'text');
        expectSelection(read('packages/core/src/shared/routes/History.module.css'), '.rowSummary', 'text');
        expectSelection(read('packages/core/src/shared/routes/History.module.css'), '.rowSourceAddress', 'text');
        expectSelection(read('packages/core/src/shared/routes/History.module.css'), '.pendingAmount', 'text');
    });

    it('keeps message previews and bodies selectable for long-press copying', () => {
        const css = read('packages/core/src/shared/routes/MessagingInbox.module.css');
        expectSelection(css, '.convPreview', 'text');
        expectSelection(css, '.messageBubble', 'text');
    });
});
