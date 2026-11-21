// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getNativePlugin } from '@xchain-wallet/core/shared/nativeShell.js';
import {
    createNativeNotifyAdapter,
    NATIVE_NOTIFY_PLUGIN,
} from './nativeNotifyAdapter.js';

export function chooseNotifyAdapter({
    env = globalThis,
    createNative = createNativeNotifyAdapter,
    createWeb,
}) {
    if (typeof createWeb !== 'function') {
        throw new TypeError('createWeb must be a function');
    }

    const plugin = getNativePlugin(NATIVE_NOTIFY_PLUGIN, { env, method: 'post' });
    return plugin ? createNative() : createWeb();
}
