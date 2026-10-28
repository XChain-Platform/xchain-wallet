// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

const { messagingState } = vi.hoisted(() => ({
    messagingState: { current: null },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ shell: 'web', messaging: messagingState.current }),
}));

let AppearanceSection;
let DisplaySection;

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function messagingHarness() {
    let stored = createDefaultSettings();
    const writes = [];
    const messaging = {
        getSettings: vi.fn(async () => structuredClone(stored)),
        updateSettings: vi.fn((patch) => {
            stored = {
                ...stored,
                ...patch,
                privacy: {
                    ...stored.privacy,
                    ...(patch.privacy || {}),
                },
            };
            const pending = deferred();
            writes.push({
                ...pending,
                answer: structuredClone(stored),
            });
            return pending.promise;
        }),
    };
    return {
        messaging,
        writes,
        stored: () => structuredClone(stored),
    };
}

async function resolveWrite(write) {
    await act(async () => {
        write.resolve(write.answer);
        await write.promise;
        await Promise.resolve();
    });
}

function settingsBroadcasts(dispatchEvent) {
    return dispatchEvent.mock.calls
        .map(([event]) => event)
        .filter((event) => event?.type === 'xc:settings-changed');
}

beforeEach(async () => {
    vi.resetModules();
    ({ AppearanceSection } = await import(
        '../../../packages/core/src/shared/components/settings/AppearanceSection.jsx'
    ));
    ({ DisplaySection } = await import(
        '../../../packages/core/src/shared/components/settings/DisplaySection.jsx'
    ));
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('stale settings answers', () => {
    it('keeps the theme chosen while an earlier privacy save is still applying', async () => {
        const harness = messagingHarness();
        messagingState.current = harness.messaging;
        const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
        render(
            <>
                <DisplaySection />
                <AppearanceSection />
            </>,
        );

        const privacy = await screen.findByRole('switch', { name: 'Hide small balances' });
        const theme = await screen.findByRole('combobox', { name: 'Theme' });
        fireEvent.click(privacy);
        await waitFor(() => expect(harness.messaging.updateSettings).toHaveBeenCalledTimes(1));

        fireEvent.change(theme, { target: { value: 'dark' } });
        await waitFor(() => expect(harness.messaging.updateSettings).toHaveBeenCalledTimes(2));
        expect(harness.writes[0].answer.theme).toBe('system');
        expect(harness.writes[1].answer.theme).toBe('dark');

        await resolveWrite(harness.writes[1]);
        await waitFor(() => expect(theme).toHaveValue('dark'));
        await resolveWrite(harness.writes[0]);

        expect(theme).toHaveValue('dark');
        const broadcasts = settingsBroadcasts(dispatchEvent);
        expect(broadcasts.at(-1)?.detail.theme).toBe('dark');
    });

    it('ends on the last clicked theme when two saves resolve out of order', async () => {
        const harness = messagingHarness();
        messagingState.current = harness.messaging;
        const dispatchEvent = vi.spyOn(window, 'dispatchEvent');
        render(<AppearanceSection />);

        const theme = await screen.findByRole('combobox', { name: 'Theme' });
        fireEvent.change(theme, { target: { value: 'dark' } });
        await waitFor(() => expect(harness.messaging.updateSettings).toHaveBeenCalledTimes(1));
        fireEvent.change(theme, { target: { value: 'light' } });
        await waitFor(() => expect(harness.messaging.updateSettings).toHaveBeenCalledTimes(2));

        await resolveWrite(harness.writes[1]);
        await waitFor(() => expect(theme).toHaveValue('light'));
        await resolveWrite(harness.writes[0]);

        expect(theme).toHaveValue('light');
        expect(harness.stored().theme).toBe('light');
        const broadcasts = settingsBroadcasts(dispatchEvent);
        expect(broadcasts.at(-1)?.detail.theme).toBe('light');
    });
});
