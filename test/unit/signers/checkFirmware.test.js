// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import { WALLET_VERSION } from '../../../packages/core/src/buildInfo.js';
import {
    checkFirmware,
    compareVersions,
} from '../../../packages/core/src/signers/checkFirmware.js';
import { FIRMWARE_MANIFEST } from '../../../packages/core/src/signers/firmware-manifest.js';

const manifest = {
    vendors: {
        acme: {
            updateUrl: 'https://example.test/update',
            models: {
                keyOne: {
                    displayName: 'Acme Key One',
                    minimum: '2.0.0',
                    recommended: '3.1.0',
                    knownVulnerable: ['2.0.1', '2.2.', '4.x'],
                    unsupported: ['1.x', '2.0.0'],
                },
            },
        },
    },
};

describe('signers/checkFirmware', () => {
    it.each([
        ['1.12', '1.12.0', 0],
        ['1.12.1', '1.12.0', 1],
        ['1.11.9', '1.12.0', -1],
        ['2.0.0-rc1', '2.0.0', -1],
        ['2.0.0', '2.0.0-rc1', 1],
        ['2.0.0-rc1', '2.0.0-rc2', -1],
    ])('compares %s with %s', (left, right, expected) => {
        expect(compareVersions(left, right)).toBe(expected);
    });

    it.each([
        ['1.9.9', 'unsupported'],
        ['2.0.0', 'unsupported'],
        ['2.0.1', 'vulnerable'],
        ['2.2.9', 'vulnerable'],
        ['2.5.0', 'outdated'],
        ['3.1.0', 'ok'],
        ['3.2.0', 'ok'],
        ['4.7.3', 'vulnerable'],
    ])('classifies firmware %s as %s', (version, status) => {
        expect(checkFirmware({ vendor: 'acme', model: 'keyOne', version, manifest }).status)
            .toBe(status);
    });

    it('returns complete model metadata and a vulnerability advisory', () => {
        expect(checkFirmware({ vendor: 'acme', model: 'keyOne', version: '2.2.7', manifest }))
            .toEqual({
                status: 'vulnerable',
                vendor: 'acme',
                model: 'keyOne',
                displayName: 'Acme Key One',
                minimum: '2.0.0',
                recommended: '3.1.0',
                updateUrl: 'https://example.test/update',
                detail: 'Firmware 2.2.7 has a known vulnerability (2.2.). Update immediately.',
                version: '2.2.7',
            });
    });

    it('treats an unreported version as unknown while retaining model metadata', () => {
        expect(checkFirmware({ vendor: 'acme', model: 'keyOne', version: '', manifest }))
            .toMatchObject({
                status: 'unknown',
                displayName: 'Acme Key One',
                minimum: '2.0.0',
                recommended: '3.1.0',
                updateUrl: 'https://example.test/update',
                detail: 'Firmware version not reported by device.',
                version: null,
            });
    });

    it('distinguishes unknown vendors and models', () => {
        expect(checkFirmware({ vendor: 'missing', model: 'keyOne', version: '1.0.0', manifest }))
            .toMatchObject({ status: 'unknown', updateUrl: null, version: '1.0.0' });
        expect(checkFirmware({ vendor: 'acme', model: 'missing', version: '1.0.0', manifest }))
            .toMatchObject({
                status: 'unknown',
                updateUrl: 'https://example.test/update',
                version: '1.0.0',
            });
    });

    it('ships a versioned manifest with supported vendor model entries', () => {
        expect(FIRMWARE_MANIFEST).toMatchObject({
            schema: 'firmware-manifest/1',
            walletVersion: WALLET_VERSION,
            vendors: {
                trezor: { models: { T1B1: { displayName: 'Trezor Model One' } } },
                ledger: { models: { nanoX: { displayName: 'Ledger Nano X' } } },
            },
        });
        expect(checkFirmware({ vendor: 'ledger', model: 'nanoS', version: '1.9.0' }).status)
            .toBe('unsupported');
    });
});
