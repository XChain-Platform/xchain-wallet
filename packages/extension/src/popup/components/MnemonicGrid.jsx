import styles from './MnemonicGrid.module.css';

/**
 * Compact mnemonic display for the 360x600 popup — numbered words in a
 * tight grid. No copy-to-clipboard by design (§19): seeds should be
 * written down, not parked in clipboard history.
 *
 * @param {object} props
 * @param {string} props.mnemonic
 */
export function MnemonicGrid({ mnemonic }) {
    const words = mnemonic.trim().split(/\s+/);
    return (
        <ol className={styles.grid} aria-label="Recovery phrase">
            {words.map((word, i) => (
                <li key={i} className={styles.cell}>
                    <span className={styles.index}>{i + 1}</span>
                    <span className={styles.word}>{word}</span>
                </li>
            ))}
        </ol>
    );
}
