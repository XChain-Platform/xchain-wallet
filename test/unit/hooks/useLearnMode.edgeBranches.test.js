// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reactState } = vi.hoisted(() => ({
    reactState: { cleanup: undefined, setOn: vi.fn() },
}));

vi.mock('react', () => ({
    useState(initialValue) {
        const value = typeof initialValue === 'function' ? initialValue() : initialValue;
        return [value, reactState.setOn];
    },
    useEffect(effect) {
        reactState.cleanup = effect();
    },
}));

const { useLearnMode } = await import(
    '../../../packages/core/src/shared/hooks/useLearnMode.js'
);

beforeEach(() => {
    reactState.cleanup = undefined;
    reactState.setOn.mockReset();
});

afterEach(() => {
    reactState.cleanup?.();
    vi.unstubAllGlobals();
});

describe('useLearnMode edge branches', () => {
    it('returns false when rendered without a document', () => {
        vi.stubGlobal('document', undefined);

        expect(useLearnMode()).toBe(false);
        expect(reactState.setOn).toHaveBeenCalledWith(false);
        expect(reactState.cleanup).toBeUndefined();
    });

    it('returns false when the document has no root element', () => {
        vi.stubGlobal('document', { documentElement: null });

        expect(useLearnMode()).toBe(false);
        expect(reactState.setOn).toHaveBeenCalledWith(false);
        expect(reactState.cleanup).toBeUndefined();
    });
});
