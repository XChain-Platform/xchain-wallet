// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: the not-found page names itself with a level-1 heading.
//
//   [P2] 2026-10-24: the page has no page header, and its title was a level-2
//        heading, so a screen reader landing on it found no h1 at all.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { RouteNotFound } from '../../packages/core/src/shared/routes/RouteNotFound.jsx';

afterEach(cleanup);

describe('regression/route-not-found-h1', () => {
    it('[REGRESSION P2] the page title is the only h1', () => {
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <RouteNotFound onHome={() => {}} />
            </MessagingProvider>,
        );
        const headings = screen.getAllByRole('heading', { level: 1 });
        expect(headings.map((h) => h.textContent)).toEqual(['Page not found']);
    });
});
