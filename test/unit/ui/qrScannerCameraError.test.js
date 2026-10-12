// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A denied or missing camera reads as an instruction the user can follow,
// never the browser's raw "Permission denied".

import { describe, it, expect } from 'vitest';
import { cameraErrorText } from '../../../packages/core/src/ui/QrScanner.jsx';

describe('cameraErrorText', () => {
    it('tells the user to allow the camera when permission is denied', () => {
        const text = cameraErrorText({ name: 'NotAllowedError', message: 'Permission denied' });
        expect(text).toMatch(/allow the camera/);
        expect(text).not.toMatch(/Permission denied/);
    });

    it('says there is no camera when none is found', () => {
        expect(cameraErrorText({ name: 'NotFoundError' })).toMatch(/No camera/);
    });

    it('offers pasting for any other failure', () => {
        expect(cameraErrorText(new Error('boom'))).toMatch(/paste the code/i);
        expect(cameraErrorText(undefined)).toMatch(/paste the code/i);
    });
});
