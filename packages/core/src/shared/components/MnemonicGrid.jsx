// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useId, useMemo, useState, useEffect } from 'react';
import { Button } from '../../ui/Button.jsx';
import { useProtectedScreen } from '../utils/screenGuard.js';
import styles from './MnemonicGrid.module.css';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/settings.js';

// Made-up filler for the concealed grid: fixed, never derived from the phrase
// and on no BIP39 list, so the blurred cells hold nothing worth reading. The
// mixed lengths only make the blur look like a grid of words.
export const PLACEHOLDER_WORDS = Object.freeze([
    'lorem', 'ipsum', 'dolor', 'amet', 'consec', 'adipis',
    'elitus', 'tempor', 'incidi', 'labore', 'magnam', 'aliqua',
]);

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
 * @param {() => void} [props.onRevealRequest] host takes over Reveal (for example to check a password first)
 * @param {boolean} [props.revealDisabled]
 * @param {boolean} [props.revealLoading]
 * @param {boolean} [props.hideRevealAction] the host draws its own Reveal button; the concealed area itself then asks the host to reveal when tapped (needs onRevealRequest)
 */
export function MnemonicGrid({ mnemonic, variant = 'full', startRevealed = false, onRevealedChange, onRevealRequest, revealDisabled = false, revealLoading = false, hideRevealAction = false }) {
    // A recovery phrase on screen is a copy of the wallet: hold the screen
    // guard for as long as the grid is mounted, whatever screen hosts it.
    useProtectedScreen();
    const mnemonicKey = useMemo(() => Symbol('mnemonic'), [mnemonic]);
    const [revealedKey, setRevealedKey] = useState(null);
    const contentId = useId();
    const words = mnemonic.trim().split(/\s+/);
    const gridClass = variant === 'small' ? styles.gridPopup : styles.gridFull;
    // startRevealed shows the words at once (the page already took the password).
    const revealed = startRevealed || revealedKey === mnemonicKey;
    // Tells the host when the words are on screen, so it can hold its
    // "I wrote it down" step until then.
    useEffect(() => { if (typeof onRevealedChange === 'function') onRevealedChange(revealed); }, [revealed, onRevealedChange]);

    return (
        <div className={styles.card} data-mnemonic-card="">
            {revealed ? (
                <ol
                    id={contentId}
                    className={gridClass}
                    aria-label={t('importWallet.recoveryPhrase')}
                    data-secret=""
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
                // Concealed, the box is named for what it hides; its blurred
                // cells are aria-hidden filler. A group, not an image, so a
                // Reveal button inside it stays reachable.
                <div role="group" aria-label={t('importWallet.recoveryPhraseHidden')}>
                    <ol
                        id={contentId}
                        className={`${gridClass} ${styles.concealedGrid}${hideRevealAction ? ` ${styles.concealedTappable}` : ''}`}
                        aria-hidden="true"
                        data-concealed-area=""
                        // Keyboard and screen-reader users reach Reveal through the host's button.
                        onClick={hideRevealAction && typeof onRevealRequest === 'function' ? () => { if (!revealLoading) onRevealRequest(); } : undefined}
                    >
                        {/* Same cell markup, numbering and classes as the revealed
                            words, so the box keeps its size; each cell holds a
                            placeholder word, never the phrase, and every word and
                            number is blurred past reading. Only the count comes from the prop. */}
                        {words.map((_, i) => (
                            <li key={i} className={styles.cell}>
                                <span className={styles.index} aria-hidden="true">{i + 1}.</span>
                                <span className={styles.word} aria-hidden="true">{PLACEHOLDER_WORDS[i % PLACEHOLDER_WORDS.length]}</span>
                            </li>
                        ))}
                    </ol>
                    {hideRevealAction ? null : (
                    <div className={styles.revealAction}>
                        <Button
                            variant="secondary"
                            size="sm"
                            aria-controls={contentId}
                            aria-expanded="false"
                            disabled={revealDisabled}
                            loading={revealLoading}
                            onClick={() => (typeof onRevealRequest === 'function' ? onRevealRequest() : setRevealedKey(mnemonicKey))}
                        >
                            {t('settings.backup.revealRecoveryPhraseAction')}
                        </Button>
                    </div>
                    )}
                </div>
            )}
        </div>
    );
}
