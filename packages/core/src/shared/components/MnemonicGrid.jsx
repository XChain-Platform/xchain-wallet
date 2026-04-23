import styles from './MnemonicGrid.module.css';

/**
 * Read-only mnemonic display per §19.2. Renders words in a numbered
 * grid so users can transcribe them to paper. Never interactive —
 * copy-to-clipboard is deliberately NOT provided; the spec wants users
 * to write seeds down rather than park them in clipboard history.
 *
 * `variant="popup"` renders a compact 3-column grid for the 360px
 * popup; `variant="full"` renders a responsive 3/4-column grid sized
 * for the full web layout.
 *
 * @param {object} props
 * @param {string} props.mnemonic
 * @param {'popup' | 'full'} [props.variant]
 */
export function MnemonicGrid({ mnemonic, variant = 'full' }) {
    const words = mnemonic.trim().split(/\s+/);
    const gridClass = variant === 'popup' ? styles.gridPopup : styles.gridFull;
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
