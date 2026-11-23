// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { installSampleFiatSource } from '../../../packages/web/src/devFiatSource.js';
import {
    DOCUMENTED_PRIMITIVES,
    SECTIONS,
} from '../../../packages/web/src/style-guide/StyleGuidePage.jsx';
import { SAMPLE_RATES } from '../../../packages/web/src/style-guide/sampleRates.js';
import { ViewContext } from '../../../packages/web/src/style-guide/frames.jsx';

vi.mock('../../../packages/web/src/style-guide/frames.jsx', async (importOriginal) => {
    const frames = await importOriginal();
    return {
        ...frames,
        ViewFrame: ({ children }) => children,
        ViewportFrame: ({ children }) => children,
        WidthTriptych: ({ render: renderExample }) => (
            <>{Object.values(frames.VIEWS).map((view) => <div key={view.id}>{renderExample(view)}</div>)}</>
        ),
    };
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('style guide sample data', () => {
    it('renders every desktop section without reaching a network API', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        installSampleFiatSource(SAMPLE_RATES);
        const requests = [];
        vi.stubGlobal('fetch', vi.fn(async (input) => {
            requests.push(
                typeof Request === 'function' && input instanceof Request
                    ? input.url
                    : String(input),
            );
            return { ok: false, status: 404, json: async () => ({}) };
        }));

        const { container } = render(
            <ViewContext.Provider value="desktop">
                {SECTIONS.map(({ id, Component }) => <Component key={id} />)}
            </ViewContext.Provider>,
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(SECTIONS.map(({ id }) => container.querySelector(`#${id}`)?.id))
            .toEqual(SECTIONS.map(({ id }) => id));
        expect([...container.querySelectorAll('.sg-component-matrix')]
            .map((matrix) => matrix.dataset.component))
            .toEqual(DOCUMENTED_PRIMITIVES);
        expect(requests.filter((url) => (
            /^(?:[a-z]+:)?\/\//i.test(url)
            || url.includes('/api/price_snapshots')
            || url.includes('/api/market')
        ))).toEqual([]);
    });
});
