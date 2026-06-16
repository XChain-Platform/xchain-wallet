// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: buildInfo.js — wallet version constants.

import { describe, it, expect } from 'vitest';
import {
    WALLET_VERSION,
    LICENSE_NAME,
    LICENSE_FILE,
    NOTICE_FILE,
    LICENSE_VERSION,
    SECURITY_FILE,
    SECURITY_PUBLISHED,
    REPRODUCIBLE_BUILD_DOC,
    REPRODUCIBLE_BUILD_DOC_DESKTOP,
    RELEASE_SIGNATURES_DOC,
    RELEASE_SIGNATURES_PUBLISHED,
    VERIFY_RELEASE_DOC,
    UPDATE_CHANNEL,
    FIRMWARE_MANIFEST_URL,
    FIRMWARE_MANIFEST_PUBLIC_KEY,
    FIRMWARE_MANIFEST_TTL_MS,
} from '../../packages/core/src/buildInfo.js';

describe('buildInfo', () => {
    it('WALLET_VERSION is a semver-shaped string', () => {
        expect(typeof WALLET_VERSION).toBe('string');
        expect(WALLET_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('LICENSE_NAME contains AGPL', () => {
        expect(LICENSE_NAME).toContain('AGPL');
    });

    it('LICENSE_FILE is LICENSE.md', () => {
        expect(LICENSE_FILE).toBe('LICENSE.md');
    });

    it('NOTICE_FILE is NOTICE.md', () => {
        expect(NOTICE_FILE).toBe('NOTICE.md');
    });

    it('LICENSE_VERSION is a non-empty string', () => {
        expect(typeof LICENSE_VERSION).toBe('string');
        expect(LICENSE_VERSION.length).toBeGreaterThan(0);
    });

    it('SECURITY_FILE is SECURITY.md', () => {
        expect(SECURITY_FILE).toBe('SECURITY.md');
    });

    it('SECURITY_PUBLISHED is a boolean', () => {
        expect(typeof SECURITY_PUBLISHED).toBe('boolean');
    });

    it('REPRODUCIBLE_BUILD_DOC is a non-empty string', () => {
        expect(typeof REPRODUCIBLE_BUILD_DOC).toBe('string');
        expect(REPRODUCIBLE_BUILD_DOC.length).toBeGreaterThan(0);
    });

    it('REPRODUCIBLE_BUILD_DOC_DESKTOP is a non-empty string', () => {
        expect(typeof REPRODUCIBLE_BUILD_DOC_DESKTOP).toBe('string');
        expect(REPRODUCIBLE_BUILD_DOC_DESKTOP.length).toBeGreaterThan(0);
    });

    it('RELEASE_SIGNATURES_DOC is a non-empty string', () => {
        expect(typeof RELEASE_SIGNATURES_DOC).toBe('string');
        expect(RELEASE_SIGNATURES_DOC.length).toBeGreaterThan(0);
    });

    it('RELEASE_SIGNATURES_PUBLISHED is a boolean', () => {
        expect(typeof RELEASE_SIGNATURES_PUBLISHED).toBe('boolean');
    });

    it('VERIFY_RELEASE_DOC is a non-empty string', () => {
        expect(typeof VERIFY_RELEASE_DOC).toBe('string');
        expect(VERIFY_RELEASE_DOC.length).toBeGreaterThan(0);
    });

    it('UPDATE_CHANNEL is a non-empty string', () => {
        expect(typeof UPDATE_CHANNEL).toBe('string');
        expect(UPDATE_CHANNEL.length).toBeGreaterThan(0);
    });

    it('FIRMWARE_MANIFEST_URL is a string', () => {
        expect(typeof FIRMWARE_MANIFEST_URL).toBe('string');
    });

    it('FIRMWARE_MANIFEST_PUBLIC_KEY is a string', () => {
        expect(typeof FIRMWARE_MANIFEST_PUBLIC_KEY).toBe('string');
    });

    it('FIRMWARE_MANIFEST_TTL_MS is a positive number (24h)', () => {
        expect(typeof FIRMWARE_MANIFEST_TTL_MS).toBe('number');
        expect(FIRMWARE_MANIFEST_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
});
