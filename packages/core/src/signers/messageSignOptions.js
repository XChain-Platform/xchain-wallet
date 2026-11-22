// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function signMessageOptsFromAddressType(addressType) {
    if (addressType === 'p2pkh') return {};
    if (addressType === 'p2sh-p2wpkh') return { segwitRedeemScript: true };
    if (addressType === 'p2wpkh') return { segwitNative: true };
    if (addressType === 'p2tr') return { format: 'bip322-simple' };
    throw new Error(`SoftwareSigner.signMessage: unsupported address type "${addressType}"`);
}

export function signMessageOptsFromPath(path) {
    const match = /^m\/(\d+)'/.exec(path);
    const purpose = match?.[1];
    if (purpose === '84') return { segwitNative: true };
    if (purpose === '49') return { segwitRedeemScript: true };
    if (purpose === '86') return { format: 'bip322-simple' };
    return {};
}
