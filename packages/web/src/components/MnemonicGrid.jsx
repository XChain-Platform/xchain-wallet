import styles from './MnemonicGrid.module.css';

/**
 * Read-only mnemonic display per §19.2. Renders the words in a numbered
 * grid so users can transcribe them to paper. The grid is never
 * interactive — copy-to-clipboard is deliberately NOT provided; the
 * spec wants users to write seeds down rather than park them in their
 * clipboard history.
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
