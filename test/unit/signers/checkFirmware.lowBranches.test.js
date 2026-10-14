// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    checkFirmware,
    compareVersions,
} from '../../../packages/core/src/signers/checkFirmware.js';

function manifest(model) {
    return { vendors: { acme: { models: { key: model } } } };
}

describe('firmware low-coverage branches', () => {
    it('accepts a model without exception lists', () => {
        expect(checkFirmware({
            vendor: 'acme', model: 'key', version: '3.0.0', manifest: manifest({}),
        }).status).toBe('ok');
    });

    it('rejects a version below the minimum without an unsupported rule match', () => {
        expect(checkFirmware({
            vendor: 'acme',
            model: 'key',
            version: '1.5.0',
            manifest: manifest({ minimum: '2.0.0', recommended: '3.0.0' }),
        })).toMatchObject({ status: 'unsupported', minimum: '2.0.0' });
    });

    it('pads missing right-side numeric version segments', () => {
        expect(compareVersions('1.0.1', '1')).toBe(1);
    });
});
