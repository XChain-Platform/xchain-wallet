// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LearnNote . The read side of Settings > Developer Mode > Learn
// Mode, which promises "explanatory copy on confirmation screens for users
// new to bitcoin / XChain mechanics" and, until now, delivered none.
//
// Renders nothing at all when the setting is off, so an experienced user
// sees exactly the confirmation screen they see today.
//
// Copy rules: plain language, no jargon the note does not itself explain,
// and it says what is TRUE of this screen rather than general education.

import { useLearnMode } from '../hooks/useLearnMode.js';
import styles from './LearnNote.module.css';

/**
 * @param {object} props
 * @param {'action'|'psbt'|'message'} [props.variant]   which confirmation surface this is
 * @param {string} [props.chainLabel]                   e.g. "Bitcoin"; named in the action copy
 * @param {string} [props.title]
 * @param {import('react').ReactNode} [props.children]  overrides the built-in copy
 */
export function LearnNote({ variant = 'action', chainLabel, title = 'New to this?', children }) {
    const enabled = useLearnMode();
    if (!enabled) return null;

    const network = chainLabel ? `the ${chainLabel} network` : 'the network';
    let body = children;
    if (!body) {
        if (variant === 'message') {
            body = 'Signing a message proves you control this address. It moves no coins and pays no fee. '
                + 'The signature can be shown to anyone as proof that you agreed to this exact text, so only sign text you understand.';
        } else if (variant === 'psbt') {
            body = 'Another app built this transaction, not your wallet, so the inputs and outputs listed above are the whole story. '
                + 'Check that the amounts and addresses are the ones you expect before approving. Your keys stay on this device either way.';
        } else {
            body = `Your wallet built this transaction on this device and nothing has been sent yet. `
                + `Approving signs it with your key and hands it to ${network}, where the fee pays for it to be included in a block. `
                + `Once it is broadcast it cannot be recalled, so the details above are your last chance to check it.`;
        }
    }

    return (
        <div className={styles.note} data-testid="learn-note">
            <span className={styles.title}>{title}</span>
            <p className={styles.body}>{body}</p>
        </div>
    );
}
