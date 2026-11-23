// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const hideReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/components/hideReachabilityNotice.js', () => ({
    useHideReachabilityNotice: hideReachability,
}));

import { ShellNoticesContext } from '../../../packages/core/src/shared/components/noticesRoute.js';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import { Notice, StatusMessageGroup } from '../../../packages/core/src/ui/StatusMessage.jsx';
import { NOTICE_TONE_BY_VARIANT, noticeToneProps } from '../../../packages/core/src/ui/noticeTone.js';

const variants = ['status', 'info', 'note', 'warning', 'error', 'danger', 'critical', 'success'];
const roles = [undefined, 'alert', 'status', 'note', null];

afterEach(() => {
    cleanup();
    hideReachability.mockReset();
});

function outcome(props) {
    hideReachability.mockClear();
    const { container, unmount } = render(
        <ShellNoticesContext.Provider value={{}}>
            <Notice {...props}>Message</Notice>
        </ShellNoticesContext.Provider>,
    );
    const box = container.querySelector('[data-variant]');
    const result = {
        role: box.getAttribute('role'),
        live: box.getAttribute('aria-live'),
        variant: box.getAttribute('data-variant'),
        tone: box.getAttribute('data-tone'),
        className: box.className,
        hideCalls: hideReachability.mock.calls,
    };
    unmount();
    return result;
}

describe('notice tone map', () => {
    it.each(variants)('preserves %s with omitted and explicit roles', (variant) => {
        for (const role of roles) {
            const roleProps = role === undefined ? {} : { role };
            expect(outcome({ ...noticeToneProps(variant), ...roleProps })).toEqual(
                outcome({ variant, ...roleProps }),
            );
        }
    });

    it('publishes all eight stable mappings', () => {
        expect(Object.keys(NOTICE_TONE_BY_VARIANT)).toEqual(variants);
        expect(noticeToneProps('warning')).toEqual({ tone: 'danger', caution: true });
        expect(noticeToneProps('unknown')).toBe(NOTICE_TONE_BY_VARIANT.status);
    });

    it.each([
        ['directly', (entries) => <StatusMessageGroup entries={entries} />],
        ['through FormPage', (entries) => (
            <FormPage status={entries.map(({ key, children, ...props }) => (
                <Notice key={key} {...props}>{children}</Notice>
            ))} />
        )],
    ])('keeps an info and caution group warning %s', (_name, view) => {
        const entries = [
            { key: 'info', ...noticeToneProps('info'), children: 'Information' },
            { key: 'caution', ...noticeToneProps('warning'), children: 'Caution' },
        ];
        const { container } = render(view(entries));

        expect(container.querySelector('[data-variant]')).toHaveAttribute('data-variant', 'warning');
    });
});
