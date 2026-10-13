// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A routed screen's title is its top-level heading, so assistive tech can
// jump to it and announce where the user is.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PageHeader } from '../../../packages/core/src/ui/PageHeader.jsx';

afterEach(() => cleanup());

describe('PageHeader title', () => {
    it('renders the title as the level-one heading', () => {
        render(<PageHeader title="Decentralized Exchange" onBack={() => {}} />);
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent).toBe('Decentralized Exchange');
    });
});
