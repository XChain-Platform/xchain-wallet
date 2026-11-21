// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { packModules, unpackModules } from '../../../packages/core/src/watch/qrMatrix.js';

describe('QR module packing', () => {
    it('round trips a generated payment QR matrix', () => {
        const modules = QRCode.create(
            'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
        ).modules;

        const packed = packModules(modules);

        expect(packed.size).toBe(modules.size);
        expect(unpackModules(packed)).toEqual(modules.data);
    });

    it('packs row-major bits most significant bit first and zero-pads the last byte', () => {
        const matrix = {
            size: 3,
            data: Uint8Array.from([
                1, 0, 1,
                0, 1, 0,
                1, 1, 1,
            ]),
        };

        expect(packModules(matrix)).toEqual({ size: 3, bits: 'q4A=' });
        expect(unpackModules({ size: 3, bits: 'q4A=' })).toEqual(matrix.data);
    });

    it('refuses a decoded byte array shorter than the matrix requires', () => {
        expect(() => unpackModules({ size: 3, bits: 'qw==' }))
            .toThrow('Packed QR matrix must decode to 2 bytes');
    });
});
