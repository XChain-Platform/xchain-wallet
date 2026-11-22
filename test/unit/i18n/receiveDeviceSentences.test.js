// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Each Receive hardware-wallet sentence is one dictionary entry, so a locale
// can reorder it and translate the "device" fallback through its select arm.
// The English must stay what the screen showed before.

import { describe, expect, it } from 'vitest';
import { format } from '../../../packages/core/src/i18n/index.js';
import { en } from '../../../packages/core/src/i18n/locales/en/index.js';

const render = (key, vars) => format(en[key], vars);

describe('Receive hardware-wallet sentences', () => {
    it('names the device in the mismatch error', () => {
        expect(render('receive.deviceShowedDifferentAddress', { hwDeviceLabel: 'Ledger' }))
            .toBe("Your Ledger showed a different address. Don't use this address. Disconnect and re-pair the device.");
        expect(render('receive.deviceShowedDifferentAddress', { hwDeviceLabel: 'device' }))
            .toBe("Your device showed a different address. Don't use this address. Disconnect and re-pair the device.");
    });

    it('names the device in the verified line', () => {
        expect(render('receive.addressVerifiedOnDevice', { hwDeviceLabel: 'Trezor' }))
            .toBe("✅ Address verified on your Trezor. It's safe to share.");
        expect(render('receive.addressVerifiedOnDevice', { hwDeviceLabel: 'device' }))
            .toBe("✅ Address verified on your device. It's safe to share.");
    });

    it('names the device in the verify hint', () => {
        expect(render('receive.verifyAddressOnDeviceHint', { hwDeviceLabel: 'Ledger' }))
            .toBe('Verify this address on your Ledger before sharing it. This protects you if the computer has been compromised.');
        expect(render('receive.verifyAddressOnDeviceHint', { hwDeviceLabel: 'device' }))
            .toBe('Verify this address on your device before sharing it. This protects you if the computer has been compromised.');
    });

    it('names the address type in the no-address notice', () => {
        expect(render('receive.noAddressOfType', { addressType: 'Native SegWit' }))
            .toBe('There is no Native SegWit address yet. Create one to receive funds with this address type.');
    });

    it('keeps the device fallback behind a select a locale can translate', () => {
        for (const key of ['receive.deviceShowedDifferentAddress', 'receive.addressVerifiedOnDevice', 'receive.verifyAddressOnDeviceHint']) {
            expect(en[key]).toContain('{hwDeviceLabel, select, device {device} other {{hwDeviceLabel}}}');
        }
    });
});
