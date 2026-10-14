// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import * as deployChunked from '../../../packages/core/src/flows/deployChunked.js';
import * as mainnetPrelaunch from '../../../packages/core/src/flows/mainnetPrelaunch.js';

describe('internal flow helpers', () => {
    it('keeps same-file helpers out of the public module namespaces', () => {
        expect(deployChunked).not.toHaveProperty('indexedActionIndex');
        expect(mainnetPrelaunch).not.toHaveProperty('isMainnetChainId');
    });
});
