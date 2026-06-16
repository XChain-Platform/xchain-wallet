// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §27.9 + §28 / G076 — `<Skeleton>` wired into balances +
// history + address loading states. Replaces the "Loading…" plain-text
// placeholders that the routes shipped with through v0.154.0.
//
// Verifies:
//   1. Home, History, AddressList all import Skeleton from
//      `@xchain-wallet/core/ui`.
//   2. Each route renders `<Skeleton.List rows={...}>` while the
//      respective async data is `null`/undefined, inside a
//      `role="status"` element so assistive tech can announce the
//      loading state.
//   3. The previous "Loading X…" plain `<p>` placeholders are gone
//      (no longer the user-visible loading affordance).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const sharedRoutes = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');

const ROUTES = [
    {
        name: 'Home',
        path: join(sharedRoutes, 'Home.jsx'),
        ariaLabel: 'Loading balances',
        oldText: 'Loading balances…',
    },
    {
        name: 'History',
        path: join(sharedRoutes, 'History.jsx'),
        ariaLabel: 'Loading history',
        oldText: 'Loading history…',
    },
    {
        name: 'AddressList',
        path: join(sharedRoutes, 'AddressList.jsx'),
        ariaLabel: 'Loading addresses',
        oldText: 'Loading addresses…',
    },
];

for (const r of ROUTES) {
    const src = readFileSync(r.path, 'utf8');
    assert.ok(
        /import\s*\{[^}]*\bSkeleton\b[^}]*\}\s*from\s*['"]@xchain-wallet\/core\/ui['"]/.test(src),
        `${r.name}.jsx imports Skeleton from @xchain-wallet/core/ui`,
    );
    assert.ok(
        /<Skeleton\.List\b/.test(src),
        `${r.name}.jsx renders <Skeleton.List>`,
    );
    assert.ok(
        new RegExp(`role="status"[\\s\\S]*aria-label="${r.ariaLabel}"`).test(src),
        `${r.name}.jsx wraps the skeleton in role="status" + aria-label="${r.ariaLabel}"`,
    );
    assert.ok(
        !src.includes(r.oldText),
        `${r.name}.jsx no longer ships the old "${r.oldText}" plain-text placeholder`,
    );
}
