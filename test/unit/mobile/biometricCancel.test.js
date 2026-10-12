// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Closing the fingerprint prompt is a choice, not a failure. On an LG K51
// (2026-10-12) it surfaced as "biometricUnlock: not supported (Fingerprint
// operation canceled by user.)" in a red error box. Both native shells now
// send one fixed detail for a dismissal, and the native provider turns it
// into BiometricCancelledError, which the screens show nothing for.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    BIOMETRIC_CANCELLED_DETAIL,
    BiometricCancelledError,
    BiometricUnsupportedError,
} from '../../../packages/core/src/flows/biometricUnlock.js';
import { nativeBiometricProvider } from '../../../packages/web/src/storage/nativeBiometricProvider.js';
import { __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';

const READY = { status: 'OK', available: true, enrolled: true, reasonCode: 'ok', mechanism: 'your fingerprint' };

function nativeVault({ enroll, unlock }) {
    return {
        loadVault: vi.fn(async () => ({ status: 'ABSENT' })),
        biometricStatus: vi.fn(async () => READY),
        biometricEnroll: vi.fn(async () => enroll),
        biometricUnlock: vi.fn(async () => unlock),
        biometricClear: vi.fn(async () => ({ status: 'OK' })),
        loadGuards: vi.fn(async () => ({})),
    };
}

afterEach(() => __setNativeVaultForTests(undefined));

describe('a dismissed prompt', () => {
    it('is a cancel when enrolling, not "not supported"', async () => {
        __setNativeVaultForTests(nativeVault({ enroll: { status: 'LOCKED', detail: BIOMETRIC_CANCELLED_DETAIL } }));
        await expect(nativeBiometricProvider.register({ password: 'pw' })).rejects.toBeInstanceOf(BiometricCancelledError);
    });

    it('is a cancel when unlocking', async () => {
        __setNativeVaultForTests(nativeVault({
            enroll: { status: 'OK' },
            unlock: { status: 'LOCKED', detail: BIOMETRIC_CANCELLED_DETAIL },
        }));
        await nativeBiometricProvider.register({ password: 'pw' });
        await expect(nativeBiometricProvider.unlock()).rejects.toBeInstanceOf(BiometricCancelledError);
    });

    it('leaves real failures as failures', async () => {
        __setNativeVaultForTests(nativeVault({ enroll: { status: 'LOCKED', detail: 'could not prepare the biometric key' } }));
        await expect(nativeBiometricProvider.register({ password: 'pw' })).rejects.toBeInstanceOf(BiometricUnsupportedError);
    });
});

describe('the cancel detail is one token across both shells', () => {
    const repo = process.cwd();
    it('Android sends it for every dismissal code', () => {
        const java = readFileSync(join(repo, 'packages', 'mobile', 'android', 'app', 'src', 'main', 'java',
            'io', 'xchain', 'wallet', 'android', 'vault', 'VaultBiometricSidecar.java'), 'utf8');
        expect(java).toContain(`CANCELLED_DETAIL = "${BIOMETRIC_CANCELLED_DETAIL}"`);
        for (const code of ['ERROR_USER_CANCELED', 'ERROR_NEGATIVE_BUTTON', 'ERROR_CANCELED']) {
            expect(java).toContain(`BiometricPrompt.${code}`);
        }
    });

    it('iOS sends it for a user cancel', () => {
        const swift = readFileSync(join(repo, 'packages', 'mobile', 'ios', 'App', 'App', 'vault', 'VaultBiometricSidecar.swift'), 'utf8');
        expect(swift).toContain(`"${BIOMETRIC_CANCELLED_DETAIL}"`);
    });
});
