// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeAppLifecycle } from '../../../packages/web/src/platform/nativeAppLifecycle.js';

function Harness({ onBackground, onResume }) {
    const suspended = useNativeAppLifecycle({
        checkAutoLock: () => false,
        onBackground,
        onUnlockedResume: onResume,
    });
    return <div data-testid="state">{suspended ? 'covered' : 'visible'}</div>;
}

function installAppPlugin(addListener) {
    globalThis.Capacitor = {
        isNativePlatform: () => true,
        Plugins: { App: { addListener } },
    };
}

afterEach(async () => {
    cleanup();
    delete globalThis.Capacitor;
    vi.restoreAllMocks();
    await Promise.resolve();
});

describe('native app lifecycle listener failures', () => {
    it('keeps document lifecycle events working after synchronous plugin failure', () => {
        installAppPlugin(() => { throw new Error('plugin disconnected'); });
        const onBackground = vi.fn();
        const onResume = vi.fn();
        const view = render(<Harness onBackground={onBackground} onResume={onResume} />);

        act(() => document.dispatchEvent(new Event('pause')));
        expect(view.getByTestId('state')).toHaveTextContent('covered');
        act(() => document.dispatchEvent(new Event('resume')));

        expect(onBackground).toHaveBeenCalledTimes(1);
        expect(onResume).toHaveBeenCalledTimes(1);
        expect(view.getByTestId('state')).toHaveTextContent('visible');
    });

    it('keeps document lifecycle events working after rejected plugin registration', async () => {
        installAppPlugin(vi.fn().mockRejectedValue(new Error('bridge unavailable')));
        const onBackground = vi.fn();
        const view = render(<Harness onBackground={onBackground} onResume={() => {}} />);
        await act(async () => { await Promise.resolve(); });

        act(() => document.dispatchEvent(new Event('pause')));

        expect(onBackground).toHaveBeenCalledTimes(1);
        expect(view.getByTestId('state')).toHaveTextContent('covered');
    });

    it('contains a listener removal rejection during unmount', async () => {
        const remove = vi.fn().mockRejectedValue(new Error('already disconnected'));
        installAppPlugin(vi.fn().mockResolvedValue({ remove }));
        const view = render(<Harness onBackground={() => {}} onResume={() => {}} />);
        await act(async () => { await Promise.resolve(); });

        view.unmount();
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });

        expect(remove).toHaveBeenCalledTimes(1);
    });
});
