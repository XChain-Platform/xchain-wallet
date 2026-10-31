// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
    CoSignApprovedSuccess,
    CoSignParams,
    PsbtSigningPath,
} from '@xchain-wallet/bridge-spec';

export function signingPathsError(entries: PsbtSigningPath[]): string | null {
    if (!Array.isArray(entries) || entries.length === 0) {
        return 'signingPaths must be a non-empty array';
    }
    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (!entry || typeof entry !== 'object') {
            return `signingPaths[${i}] must be an object`;
        }
        if (!Number.isInteger(entry.inputIndex) || entry.inputIndex < 0) {
            return `signingPaths[${i}].inputIndex must be a non-negative integer`;
        }
        const hasAddress = typeof entry.address === 'string' && entry.address.length > 0;
        const hasPath = typeof entry.derivationPath === 'string' && entry.derivationPath.length > 0;
        if (hasAddress === hasPath) {
            return `signingPaths[${i}] must carry exactly one of address or derivationPath`;
        }
        if (entry.sighashType !== undefined && !Number.isInteger(entry.sighashType)) {
            return `signingPaths[${i}].sighashType must be an integer`;
        }
    }
    return null;
}

const signatureFor = (index: number) => ({
    index,
    publicNonce: `mock-public-nonce-${index}`,
    sig: `mock-partial-sig-${index}`,
    msg: `mock-message-${index}`,
});

export function approvedCoSign(params: CoSignParams): CoSignApprovedSuccess {
    if (params.inputs?.length) {
        return {
            ok: true,
            approved: true,
            action: 'SEND',
            signatures: params.inputs.map(({ index }) => signatureFor(index)),
        };
    }
    const { index: _index, ...signature } = signatureFor(params.inputIndex ?? 0);
    return { ok: true, approved: true, action: 'SEND', ...signature };
}
