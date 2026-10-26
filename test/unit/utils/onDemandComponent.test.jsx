// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import {
    onDemandComponent,
    openWhenLoaded,
} from '../../../packages/core/src/shared/utils/onDemandComponent.js';

afterEach(() => {
    cleanup();
});

function deferredModule(component) {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const load = vi.fn(() => promise);
    return { load, finish: () => resolve({ Surface: component }) };
}

function Surface({ label, surfaceRef }) {
    return <div ref={surfaceRef} role="dialog" aria-label={label}>{label}</div>;
}

describe('onDemandComponent', () => {
    it('renders nothing until the module loads, then the real component', async () => {
        const { load, finish } = deferredModule(Surface);
        const OnDemand = onDemandComponent(load, 'Surface');

        render(<OnDemand label="Late" />);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(OnDemand.isLoaded()).toBe(false);

        await act(async () => { finish(); });
        expect(await screen.findByRole('dialog', { name: 'Late' })).toBeTruthy();
        expect(OnDemand.isLoaded()).toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('renders synchronously once loaded, so an owner effect sees the ref in its first commit', async () => {
        const { load, finish } = deferredModule(Surface);
        const OnDemand = onDemandComponent(load, 'Surface');
        finish();
        await OnDemand.preload();

        const seen = [];
        function Owner() {
            const ref = useRef(null);
            useEffect(() => { seen.push(ref.current?.textContent ?? null); }, []);
            return <OnDemand label="Ready" surfaceRef={ref} />;
        }
        render(<Owner />);
        expect(screen.getByRole('dialog', { name: 'Ready' })).toBeTruthy();
        expect(seen).toEqual(['Ready']);
    });

    it('shares one load between preload calls and retries after a failure', async () => {
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ Surface });
        const OnDemand = onDemandComponent(load, 'Surface');

        await expect(OnDemand.preload()).rejects.toThrow('offline');
        await Promise.all([OnDemand.preload(), OnDemand.preload()]);
        expect(load).toHaveBeenCalledTimes(2);
        expect(OnDemand.isLoaded()).toBe(true);
    });
});

describe('openWhenLoaded', () => {
    it('opens at once when loaded and after the load otherwise', async () => {
        const { load, finish } = deferredModule(Surface);
        const OnDemand = onDemandComponent(load, 'Surface');
        const open = vi.fn();

        openWhenLoaded(OnDemand, open);
        expect(open).not.toHaveBeenCalled();
        finish();
        await OnDemand.preload();
        await Promise.resolve();
        expect(open).toHaveBeenCalledTimes(1);

        openWhenLoaded(OnDemand, open);
        expect(open).toHaveBeenCalledTimes(2);
    });
});
