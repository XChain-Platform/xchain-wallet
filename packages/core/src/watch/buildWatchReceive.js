// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defaultRegistry } from '../registry/index.js';
import { receiveQrUri } from '../shared/utils/receiveQrUri.js';
import { qrMatrix } from './qrMatrix.js';

export function groupAddress(address) {
    if (typeof address !== 'string') return '';

    const trimmed = address.trim();
    return trimmed.match(/.{1,4}/g)?.join(' ') ?? '';
}

export function buildWatchReceive(activeByChain, chainRegistry = defaultRegistry()) {
    const receive = [];

    for (const [chainId, active] of Object.entries(activeByChain || {})) {
        const address = typeof active?.address === 'string' ? active.address.trim() : '';
        const descriptor = chainRegistry?.get?.(chainId);
        const uri = receiveQrUri({
            descriptor,
            chainId,
            address,
            label: active?.label,
        });
        if (!address || !descriptor || !uri) continue;

        receive.push({
            chainId,
            label: descriptor.displayName || chainId,
            address: groupAddress(address),
            qr: qrMatrix(uri),
        });
    }

    return receive;
}
