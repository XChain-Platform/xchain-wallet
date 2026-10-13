// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RawPsbtViewer } from '../../../packages/core/src/shared/components/RawPsbtViewer.jsx';
import { WatcherResultPanel } from '../../../packages/core/src/shared/components/WatcherResultPanel.jsx';

let writeText;

beforeEach(() => {
    writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
});

afterEach(() => {
    cleanup();
    delete navigator.clipboard;
});

describe('clipboard control feedback', () => {
    it('confirms a successful watcher transaction copy inline', async () => {
        writeText.mockResolvedValueOnce(undefined);
        render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copied')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when raw transaction copying is unavailable', async () => {
        render(<RawPsbtViewer developerMode psbtHex="deadbeef" />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });

    it('reports a plain failure when watcher transaction copying is unavailable', async () => {
        render(
            <WatcherResultPanel
                result={{ psbtHex: 'deadbeef' }}
                onDone={() => {}}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Copy unsigned transaction hex' }));

        expect(await screen.findByText('Copy failed: clipboard unavailable')).toBeTruthy();
        expect(writeText).toHaveBeenCalledWith('deadbeef');
    });
});
