// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import styles from './MnemonicGrid.module.css';

/**
 * Read-only mnemonic display per §19.2. Renders words in a numbered
 * grid so users can transcribe them to paper. Never interactive;
 * copy-to-clipboard is deliberately NOT provided. The spec wants users
 * to write seeds down rather than park them in clipboard history.
 *
 * `variant="small"` renders a compact 3-column grid for the narrow
 * (popup / mobile) viewport; `variant="full"` renders a responsive
 * 3/4-column grid sized for the full web layout.
 *
 * @param {object} props
 * @param {string} props.mnemonic
 * @param {'small' | 'full'} [props.variant]
 */
export function MnemonicGrid({ mnemonic, variant = 'full' }) {
    const words = mnemonic.trim().split(/\s+/);
    const gridClass = variant === 'small' ? styles.gridPopup : styles.gridFull;
    return (
        <ol className={gridClass} aria-label="Recovery phrase">
            {words.map((word, i) => (
                <li key={i} className={styles.cell}>
                    <span className={styles.index}>{i + 1}</span>
                    <span className={styles.word}>{word}</span>
                </li>
            ))}
        </ol>
    );
}
