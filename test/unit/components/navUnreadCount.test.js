// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The bell's red count is the one unread count in the app shell: the
// sidebar nav and the bottom tab bar never show an unread badge or dot.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const components = join(process.cwd(), 'packages/core/src/shared/components');
const read = (name) => readFileSync(join(components, name), 'utf8');

describe('unread counts in the app shell', () => {
    it.each([
        'LeftNav.jsx',
        'LeftNav.module.css',
        'BottomTabBar.jsx',
        'BottomTabBar.module.css',
    ])('%s carries no unread badge or dot', (name) => {
        const src = read(name);
        expect(src).not.toMatch(/unread/i);
        expect(src).not.toMatch(/badge/i);
        expect(src).not.toMatch(/\.dot\b|styles\.dot\b/);
    });

    it('keeps the red count on the bell', () => {
        const header = read('AppHeader.jsx');
        expect(header).toMatch(/notificationsUnread/);
        expect(header).toMatch(/styles\.bellBadge/);
    });
});
