// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    checkFirmware,
    compareVersions,
} from '../../../packages/core/src/signers/checkFirmware.js';

const sparseManifest = {
    vendors: {
        acme: {
            models: {
                key: {
                    unsupported: [null, '1.x', '2.0.'],
                    knownVulnerable: ['1.x', '2.0.5'],
                },
            },
        },
    },
};

describe('checkFirmware edge classification', () => {
    it('returns null optional metadata when a sparse model accepts a version', () => {
        expect(checkFirmware({
            vendor: 'acme', model: 'key', version: '3.0.0', manifest: sparseManifest,
        })).toEqual({
            status: 'ok',
            vendor: 'acme',
            model: 'key',
            displayName: null,
            minimum: null,
            recommended: null,
            updateUrl: null,
            detail: null,
            version: '3.0.0',
        });
    });

    it.each([undefined, null, 0, false])(
        'treats non-string version %j as unreported',
        (version) => {
            expect(checkFirmware({
                vendor: 'acme', model: 'key', version, manifest: sparseManifest,
            })).toMatchObject({ status: 'unknown', version: null });
        },
    );

    it('matches a major-only rule against the bare major and gives unsupported precedence', () => {
        const result = checkFirmware({
            vendor: 'acme', model: 'key', version: '1', manifest: sparseManifest,
        });
        expect(result.status).toBe('unsupported');
        expect(result.detail).toContain('not supported');
    });

    it('skips non-string rules and matches a dotted prefix', () => {
        expect(checkFirmware({
            vendor: 'acme', model: 'key', version: '2.0.9', manifest: sparseManifest,
        }).status).toBe('unsupported');
    });

    it('handles manifests without a vendors collection', () => {
        expect(checkFirmware({ vendor: 'acme', model: 'key', version: '', manifest: {} }))
            .toMatchObject({ status: 'unknown', updateUrl: null, version: null });
    });
});

describe('compareVersions edge ordering', () => {
    it.each([
        ['1.0.0+build.1', '1.0.0', -1],
        ['release-a', 'release-b', -1],
        ['release-b', 'release-a', 1],
        ['release', 'release', 0],
        [1, '1.0.0', 0],
    ])('compares %j with %j', (left, right, expected) => {
        expect(compareVersions(left, right)).toBe(expected);
    });
});
