// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useState } from 'react';
import { Button } from '../../ui/Button.jsx';
import styles from './MnemonicGrid.module.css';

/**
 * Read-only mnemonic display per §19.2. Keeps the phrase concealed until the
 * user explicitly reveals it, then renders numbered words for transcription.
 * Clipboard copying remains disabled because clipboard history can retain key
 * material after this screen closes.
 *
 * `variant="small"` renders a compact 2-column grid for the narrow
 * (popup / mobile) viewport; `variant="full"` renders a responsive
 * 2/4-column grid sized for the full web layout.
 *
 * @param {object} props
 * @param {string} props.mnemonic
 * @param {'small' | 'full'} [props.variant]
 */
export function MnemonicGrid({ mnemonic, variant = 'full' }) {
    const [revealedMnemonic, setRevealedMnemonic] = useState(null);
    const contentId = useId();
    const words = mnemonic.trim().split(/\s+/);
    const gridClass = variant === 'small' ? styles.gridPopup : styles.gridFull;
    const revealed = revealedMnemonic === mnemonic;

    return (
        <div className={styles.container}>
            <div className={styles.revealAction}>
                <Button
                    variant={revealed ? 'ghost' : 'secondary'}
                    size="sm"
                    aria-controls={contentId}
                    aria-expanded={revealed}
                    onClick={() => setRevealedMnemonic(revealed ? null : mnemonic)}
                >
                    {revealed ? 'Hide recovery phrase' : 'Reveal recovery phrase'}
                </Button>
            </div>
            <div id={contentId}>
                {revealed ? (
                    <ol
                        className={gridClass}
                        aria-label="Recovery phrase"
                        onCopy={(event) => event.preventDefault()}
                    >
                        {words.map((word, i) => (
                            <li key={i} className={styles.cell} aria-label={`${i + 1}. ${word}`}>
                                <span className={styles.index} aria-hidden="true">{i + 1}.</span>
                                <span className={styles.word} aria-hidden="true">{word}</span>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className={styles.concealedMessage}>
                        Recovery phrase hidden. Make sure no one can see your screen before revealing it.
                    </p>
                )}
            </div>
        </div>
    );
}
