// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useGatedTickNotice (PC-26 warning leg): the gated-content SEND rule
// is SEND-only by design - AIRDROP, DISPENSER dispenses, ORDER/SWAP
// settlement and DIVIDEND move gated tokens with NO key handoff, so
// recipients through those flows get a token whose content they cannot
// open. This hook detects a gated give-side tick so each authoring
// form can say so before the user signs. Detection only; it never
// blocks (the flows are protocol-valid).

import { useEffect, useRef, useState } from 'react';
import { isDemoGatedActionIndex } from '../../flows/demoGatedContent.js';

/**
 * @param {{
 *   messaging: { listGatedContent?: (req: { chainId: string, tick: string }) => Promise<any[]> },
 *   chainId: string | null | undefined,
 *   tick: string | null | undefined,
 *   enabled?: boolean,
 * }} params
 * @returns {{ gated: boolean, packCount: number, fileCount: number }}
 */
export function useGatedTickNotice({ messaging, chainId, tick, enabled = true }) {
    const [notice, setNotice] = useState({ gated: false, packCount: 0, fileCount: 0 });
    const seqRef = useRef(0);

    useEffect(() => {
        setNotice({ gated: false, packCount: 0, fileCount: 0 });
        const trimmed = typeof tick === 'string' ? tick.trim() : '';
        if (!enabled || !chainId || !trimmed || trimmed.startsWith('^')) return undefined;
        if (typeof messaging?.listGatedContent !== 'function') return undefined;
        const seq = seqRef.current + 1;
        seqRef.current = seq;
        const timer = setTimeout(() => {
            messaging.listGatedContent({ chainId, tick: trimmed.toUpperCase() })
                .then((groups) => {
                    if (seqRef.current !== seq) return;
                    // Demo fixtures are display-only; mirror the send guard's
                    // filter so a real form never warns off demo data.
                    const real = (Array.isArray(groups) ? groups : []).filter((g) => {
                        const files = Array.isArray(g?.files) ? g.files : [];
                        return files.length > 0 && !files.every((f) => isDemoGatedActionIndex(f.actionIndex));
                    });
                    setNotice({
                        gated: real.length > 0,
                        packCount: real.length,
                        fileCount: real.reduce((n, g) => n + g.files.length, 0),
                    });
                })
                .catch(() => {
                    // Silent: a detection failure must not add noise to an
                    // authoring form; the rule itself is enforced elsewhere.
                });
        }, 400);
        return () => { clearTimeout(timer); };
    }, [messaging, chainId, tick, enabled]);

    return notice;
}

/**
 * The shared warning copy, so every flow states the same fact the same
 * way. `flowNoun` names the delivery ("airdrop recipients", "buyers", ...).
 *
 * @param {string} tick
 * @param {string} flowNoun
 * @returns {string}
 */
export function gatedTickWarningCopy(tick, flowNoun) {
    return `${String(tick).trim().toUpperCase()} has token-gated content. Unlock keys hand off only through a direct Send; `
        + `${flowNoun} will receive the token WITHOUT the key and will not be able to open its gated content `
        + '(they would need the key re-sent to them separately).';
}
