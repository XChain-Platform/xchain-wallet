// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Turning on biometric unlock asks for a match on iOS, as it does on Android.
// Adding a Keychain item under a biometric access control prompts for
// nothing, so the iOS sidecar asks LocalAuthentication for a match first and
// writes the wrap only after one. A dismissal answers with the shared cancel
// detail, so the settings row treats it as a choice; any other ending is a
// refusal the row already shows with a retry.
//
// The Swift is not compiled in CI, so these checks read it as text, comments
// removed, the way the iOS vault smoke does.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIOMETRIC_CANCELLED_DETAIL } from '../../../packages/core/src/flows/biometricUnlock.js';

const vaultDir = join(process.cwd(), 'packages', 'mobile', 'ios', 'App', 'App', 'vault');

function codeOnly(text) {
    return text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

/** The body of the first function whose declaration matches `signature`, braces balanced. */
function bodyOf(source, signature) {
    const match = signature.exec(source);
    if (!match) return null;
    const open = source.indexOf('{', match.index + match[0].length - 1);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open + 1, i);
        }
    }
    return null;
}

const sidecar = codeOnly(readFileSync(join(vaultDir, 'VaultBiometricSidecar.swift'), 'utf8'));
const plugin = codeOnly(readFileSync(join(vaultDir, 'XChainVaultPlugin.swift'), 'utf8'));

describe('iOS biometric enrolment', () => {
    const enroll = bodyOf(sidecar, /func enroll\(secret:[^{]*\{/);

    it('asks for a biometric match', () => {
        expect(enroll).not.toBeNull();
        expect(enroll).toMatch(/\.evaluatePolicy\(\s*\.deviceOwnerAuthenticationWithBiometrics\s*,/);
    });

    it('writes or clears the wrap only after the match succeeds', () => {
        const afterMatch = enroll.slice(enroll.search(/guard matched else/));
        expect(afterMatch.length).toBeLessThan(enroll.length);
        const beforeMatch = enroll.slice(0, enroll.length - afterMatch.length);
        for (const write of ['SecItemAdd', 'clear()', 'storeWrap(']) {
            expect(beforeMatch).not.toContain(write);
        }
        expect(afterMatch).toMatch(/storeWrap\(secret: secret\)/);
        // SecItemAdd lives only in storeWrap, and storeWrap runs only from enroll.
        expect(sidecar.match(/SecItemAdd\(/g)).toHaveLength(1);
        expect(bodyOf(sidecar, /private func storeWrap\(secret: Data\)[^{]*\{/)).toContain('SecItemAdd(');
        expect(sidecar.match(/storeWrap\(secret: secret\)/g)).toHaveLength(1);
    });

    it('answers every dismissal with the cancel detail the SPA reads', () => {
        expect(sidecar).toContain(`static let cancelledDetail = "${BIOMETRIC_CANCELLED_DETAIL}"`);
        const refusal = bodyOf(sidecar, /func enrollRefusal\(for error: Error\?\)[^{]*\{/);
        expect(refusal).not.toBeNull();
        expect(refusal).toMatch(/case \.userCancel, \.appCancel, \.systemCancel, \.userFallback:\s*return cancelledDetail/);
    });

    it('resolves the bridge call from the prompt completion', () => {
        const method = bodyOf(plugin, /@objc func biometricEnroll\(_ call: CAPPluginCall\)\s*\{/);
        expect(method).toMatch(/sidecar\.enroll\(secret: secret, reason: "[^"]+"\) \{ refusal in/);
        expect(method).toMatch(/"status": "LOCKED", "detail": refusal/);
        expect(method).toMatch(/"status": "OK"/);
    });

    it('keeps the unlock released by the Keychain, not by an evaluatePolicy result', () => {
        const unlock = bodyOf(sidecar, /func unlock\(reason: String[^{]*\{/);
        expect(unlock).not.toBeNull();
        expect(unlock).not.toContain('evaluatePolicy');
        expect(unlock).toContain('SecItemCopyMatching');
    });
});
