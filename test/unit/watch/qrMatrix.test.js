// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { qrMatrix, unpackModules } from '../../../packages/core/src/watch/qrMatrix.js';

describe('qrMatrix', () => {
    it('packs the same payment URI matrix Receive renders', () => {
        const uri = 'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?chain=bitcoin';
        const expected = QRCode.create(uri, { errorCorrectionLevel: 'M' }).modules;
        const packed = qrMatrix(uri);

        expect(packed.size).toBe(expected.size);
        expect(unpackModules(packed)).toEqual(expected.data);
    });
});
