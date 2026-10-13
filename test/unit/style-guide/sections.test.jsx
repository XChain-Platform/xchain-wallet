// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SECTIONS } from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';
import { VIEWS, ViewContext } from '../../../packages/web/src/style-guide/frames.jsx';

vi.mock('../../../packages/web/src/style-guide/frames.jsx', async (importOriginal) => {
    const frames = await importOriginal();
    return {
        ...frames,
        ViewFrame: ({ children }) => children,
        WidthTriptych: ({ render: renderExample }) => Object.values(frames.VIEWS).map((exampleView) => (
            <div key={exampleView.id}>{renderExample(exampleView)}</div>
        )),
    };
});

describe.each(Object.values(VIEWS))('$label style-guide sections', ({ id: view }) => {
    it.each(SECTIONS)('$label renders with a heading', ({ id, Component }) => {
        render(
            <ViewContext.Provider value={view}>
                <Component />
            </ViewContext.Provider>,
        );

        const section = document.getElementById(id);
        expect(section).toBeInTheDocument();
        expect(section.querySelector(':scope > h2')).toHaveTextContent(/\S/);
    });
});
