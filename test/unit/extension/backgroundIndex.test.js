// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import * as background from '../../../packages/extension/src/background/index.js';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { ApprovalBroker } from '../../../packages/extension/src/background/approvalBroker.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { createConnectedTabRegistry } from '../../../packages/extension/src/background/connectedTabs.js';

describe('extension background public surface', () => {
    it('re-exports the primary host and session entry points', () => {
        expect(background.MessageHost).toBe(MessageHost);
        expect(background.ApprovalBroker).toBe(ApprovalBroker);
        expect(background.createBackgroundHost).toBe(createBackgroundHost);
        expect(background.createConnectedTabRegistry).toBe(createConnectedTabRegistry);
        expect(background.attachChromeRuntime).toEqual(expect.any(Function));
        expect(background.attachSessionMetaListener).toEqual(expect.any(Function));
        expect(background.attachSignerBridgeListener).toEqual(expect.any(Function));
        expect(background.attachWipeStorageListener).toEqual(expect.any(Function));
    });

    it('publishes signer-bridge and layout APIs through the barrel', () => {
        expect(background.signerBridge).toEqual(expect.objectContaining({
            getTransport: expect.any(Function),
        }));
        expect(background.LAYOUT_MODES).toEqual(['popup', 'sidepanel']);
        expect(background.applyLayoutMode).toEqual(expect.any(Function));
        expect(background.readLayoutMode).toEqual(expect.any(Function));
        expect(background.writeLayoutMode).toEqual(expect.any(Function));
    });
});
