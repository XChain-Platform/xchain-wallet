// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    imagePreviewDataUrl,
    publishFileType,
} from '../../../../packages/core/src/shared/utils/publishingFile.js';

describe('publishing file validation and previews', () => {
    it('accepts standard MIME types and supplies a binary fallback', () => {
        expect(publishFileType({ type: 'image/png' })).toEqual({ type: 'image/png', error: null });
        expect(publishFileType({ type: '' })).toEqual({ type: 'application/octet-stream', error: null });
    });

    it('rejects malformed or action-delimiting MIME metadata', () => {
        expect(publishFileType({ type: 'image/png;payload' }).error).toMatch(/invalid content type/);
        expect(publishFileType({ type: 'image|png' }).error).toMatch(/invalid content type/);
    });

    it('previews only image bytes identified from their content', () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(imagePreviewDataUrl(png)).toMatch(/^data:image\/png;base64,/);
        expect(imagePreviewDataUrl(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    });
});
