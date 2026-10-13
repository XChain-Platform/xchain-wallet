// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { statusCopy } from '../../../packages/core/src/shared/components/HwSignBlock.jsx';

describe('HwSignBlock error copy', () => {
    it('replaces device error codes with recovery guidance', () => {
        const text = statusCopy('error', 'ledger', 'bitcoin-mainnet', 'ERR_DEVICE_NOT_FOUND');
        expect(text).toBe("Couldn't reach device. Check the connection and try again.");
        expect(text).not.toContain('ERR_DEVICE_NOT_FOUND');
    });

    it('keeps useful device guidance', () => {
        const text = statusCopy('disconnected', 'trezor', 'bitcoin-mainnet', 'Reconnect the USB cable.');
        expect(text).toBe('Device not detected. Reconnect the USB cable.');
    });
});
