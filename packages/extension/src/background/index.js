// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

export {
    MessageHost,
    UnknownMessageTypeError,
    InvalidMessageError,
} from './MessageHost.js';
export { createBackgroundHost } from './createBackgroundHost.js';
export { attachChromeRuntime } from './ChromeRuntimeAdapter.js';
export {
    createConnectedTabRegistry,
    CONNECTED_TABS_SESSION_KEY,
    DEFAULT_MAX_CONNECTED_TABS,
} from './connectedTabs.js';
export {
    attachSessionMetaListener,
    dispatchPreHost,
    handleSessionStatus,
    PRE_HOST_MESSAGE_TYPES,
} from './sessionMeta.js';
export { ApprovalBroker } from './approvalBroker.js';
export { resolveSdkFactory, createDevMockSdk } from './sdkFactory.js';
export { attachSignerBridgeListener } from './signerBridgeListener.js';
export * as signerBridge from './signerBridge.js';
export {
    LAYOUT_MODES,
    isSidePanelSupported,
    readLayoutMode,
    writeLayoutMode,
    applyLayoutMode,
    attachLayoutModeListener,
} from './layoutMode.js';
