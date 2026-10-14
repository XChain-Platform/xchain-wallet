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

function codeOf(file) {
    return readFileSync(resolve(process.cwd(), file), 'utf8')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe.each(FILES)('%s network-label rendering', (file) => {
    it('does not send a text chain label or network kind to rendered UI', () => {
        const code = codeOf(file);
        expect(code).not.toMatch(/\bchainLabel\s*=/);
        expect(code).not.toMatch(/showNetworkKind/);
        expect(code).not.toMatch(/\$\{[^}]*networkKind[^}]*\}/);
        expect(code).not.toMatch(/(?:descriptor|sourceDescriptor|destDescriptor)\??\.displayName/);
    });

    it('makes every read-only chain badge icon-only', () => {
        const badges = [...codeOf(file).matchAll(/<ChainBadge\b[^>]*\/>/g)].map((match) => match[0]);
        for (const badge of badges) expect(badge).toContain('showName={false}');
    });

    it('suppresses network-kind text in every chain picker', () => {
        const pickers = [...codeOf(file).matchAll(/<ChainPicker\b[\s\S]*?\/>/g)].map((match) => match[0]);
        for (const picker of pickers) expect(picker).toContain('hideNetworkKind');
        expect(codeOf(file)).not.toContain('<NetworkField');
    });
});
