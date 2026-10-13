// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';

import * as sdk from '../../../packages/core/src/sdk/index.js';
import {
    DEFAULT_SDK_NETWORK_OPTIONS,
    SDKRegistry,
    UnknownChainError,
    endpointOverridesFromSettings,
    joinEndpoint,
} from '../../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { isDevMockAddress, mockDeriveAddress } from '../../../packages/core/src/sdk/devMockAddresses.js';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

describe('sdk public barrel', () => {
    it('exports the supported SDK integration surface', () => {
        const expected = {
            DEFAULT_SDK_NETWORK_OPTIONS,
            SDKRegistry,
            UnknownChainError,
            adaptXChainSDK,
            endpointOverridesFromSettings,
            isDevMockAddress,
            joinEndpoint,
            mockDeriveAddress,
            submitWithSigner,
        };

        expect(Object.keys(sdk).sort()).toEqual(Object.keys(expected).sort());
        for (const [name, binding] of Object.entries(expected)) {
            expect(sdk[name], name).toBe(binding);
        }
    });
});
