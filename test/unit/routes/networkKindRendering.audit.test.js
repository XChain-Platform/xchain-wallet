// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
    'packages/core/src/shared/components/QueuedBroadcastBanner.jsx',
    'packages/core/src/shared/routes/AddAddressModal.jsx',
    'packages/core/src/shared/routes/AddressList.jsx',
    'packages/core/src/shared/routes/AddressPreferencesForm.jsx',
    'packages/core/src/shared/routes/AdvancedActionsForm.jsx',
    'packages/core/src/shared/routes/AirdropForm.jsx',
    'packages/core/src/shared/routes/AttachContentForm.jsx',
    'packages/core/src/shared/routes/BatchComposerForm.jsx',
    'packages/core/src/shared/routes/BridgeMoveForm.jsx',
    'packages/core/src/shared/routes/BroadcastForm.jsx',
    'packages/core/src/shared/routes/CallbackForm.jsx',
    'packages/core/src/shared/routes/CoSignerAccountDetail.jsx',
    'packages/core/src/shared/routes/CoSignerAccountList.jsx',
];

const namesReadSource = String.raw`(?:descriptor|sourceDescriptor|destDescriptor)\??\.displayName|\.get\([^)]*\)\??\.displayName`;
const confirmChainLabelSource = /^\s*chainLabel=\{descriptor\?\.displayName \|\| chainId\}\s*$/gm;

function codeOf(file) {
    return readFileSync(resolve(process.cwd(), file), 'utf8')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe.each(FILES)('%s network-label rendering', (file) => {
    it('keeps text chain labels on Confirm Standard and network-kind text out of rendered UI', () => {
        const code = codeOf(file);
        const confirmChainLabels = [...code.matchAll(confirmChainLabelSource)];
        for (const match of confirmChainLabels) {
            const modalStart = code.lastIndexOf('<ConfirmActionModal', match.index);
            expect(modalStart).toBeGreaterThanOrEqual(0);
            expect(code.indexOf('/>', modalStart)).toBeGreaterThan(match.index);
        }
        const outsideConfirm = code.replace(confirmChainLabelSource, '');
        expect(outsideConfirm).not.toMatch(/\bchainLabel\s*=/);
        expect(outsideConfirm).not.toMatch(/showNetworkKind/);
        expect(outsideConfirm).not.toMatch(/\$\{[^}]*networkKind[^}]*\}/);
        // A coin network's name read straight off a descriptor or a registry
        // lookup; the second form closes the gap a helper wrapping
        // `registry.get(id)?.displayName` would otherwise slip through.
        const namesRead = new RegExp(namesReadSource);
        // Reviewed exceptions, each still suppressing mainnet, testnet and
        // regtest text: Bridge move names both coin networks in its
        // irreversible-transfer notice; Batch heads each transaction with its
        // network, From address and "Transaction N" (operator ruling on Batch
        // compose 2026-11-12, layout B, screen-review notes.jsonl), the
        // per-transaction form of the From summary that G20 and G61 keep
        // naming the network. The later layout 1 pick (nested sections) does
        // not restate it; this exception is a reviewer's reading, to confirm
        // with the operator against U12.
        if (!file.endsWith('/BridgeMoveForm.jsx') && !file.endsWith('/BatchComposerForm.jsx')) {
            expect(outsideConfirm).not.toMatch(namesRead);
        }
    });

    it('Batch reads the network name only for its From summary', () => {
        if (!file.endsWith('/BatchComposerForm.jsx')) return;
        const code = codeOf(file);
        // One read, off the transaction's own descriptor, never a wrapper.
        expect([...code.matchAll(new RegExp(namesReadSource, 'g'))].map((m) => m[0]))
            .toEqual(['descriptor?.displayName']);
    });

    it('makes every read-only chain badge icon-only', () => {
        const badges = [...codeOf(file).matchAll(/<ChainBadge\b[^>]*\/>/g)].map((match) => match[0]);
        for (const badge of badges) expect(badge).toContain('showName={false}');
    });

    it('suppresses network-kind text in every remaining chain picker', () => {
        const pickers = [...codeOf(file).matchAll(/<ChainPicker\b[\s\S]*?\/>/g)].map((match) => match[0]);
        for (const picker of pickers) expect(picker).toContain('hideNetworkKind');
    });
});
