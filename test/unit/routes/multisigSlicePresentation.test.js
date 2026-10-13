// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = (name) => readFileSync(join(
    process.cwd(), 'packages', 'core', 'src', 'shared', 'routes', name,
), 'utf8');

describe('multisig slice presentation safeguards', () => {
    it('uses theme tokens for status and accent colors', () => {
        const compose = route('ComposeMessage.jsx');
        const parallel = route('ParallelComposer.jsx');
        const inbox = route('MessagingInbox.jsx');

        expect(compose).not.toMatch(/#ef5350|#f59e0b/i);
        expect(compose).toContain("color: 'var(--xc-danger-fg)'");
        expect(compose).toContain("border: '1px solid var(--xc-warning)'");
        expect(parallel).not.toContain("color: '#b00'");
        expect(parallel).toContain("color: 'var(--xc-danger-fg)'");
        expect(inbox).not.toContain("color: isOutgoing ? '#FFFFFF'");
        expect(inbox).toContain("color: isOutgoing ? 'var(--xc-on-accent)'");
    });

    it('keeps long pages in one scroll flow', () => {
        const inboxCss = route('MessagingInbox.module.css');
        const pairing = route('PairPartnerWallet.jsx');
        const conversationList = inboxCss.match(/\.convList\s*\{[^}]*\}/s)?.[0] || '';
        const codeBox = pairing.match(/const CODE_BOX\s*=\s*\{[^}]*\}/s)?.[0] || '';

        expect(conversationList).not.toMatch(/overflow-y|max-height/i);
        expect(codeBox).not.toMatch(/overflowY|maxHeight/);
    });

    it('wraps multi-control rows on narrow screens', () => {
        const policy = route('CoSignerPolicyEditor.jsx');
        const psbt = route('PsbtSignForm.jsx');
        const inboxCss = route('MessagingInbox.module.css');
        const requestActions = inboxCss.match(/\.requestActions\s*\{[^}]*\}/s)?.[0] || '';

        expect(policy).toMatch(/const rowStyle = \{[^}]*flexWrap: 'wrap'/s);
        expect(psbt).toContain("display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)'");
        expect(requestActions).toContain('flex-wrap: wrap');
    });

    it('keeps unavailable feature messages free of shell method names', () => {
        const sign = route('SignMessageForm.jsx');
        const verify = route('VerifySignatureForm.jsx');

        expect(sign).toContain('Message signing is not available in this app.');
        expect(sign).not.toContain('messaging.signMessageRequest is not available');
        expect(verify).toContain('Signature verification is not available in this app.');
        expect(verify).not.toContain('messaging.verifyMessageRequest is not available');
    });
});
