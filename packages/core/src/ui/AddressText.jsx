import styles from './AddressText.module.css';

/**
 * Monospace address display. When `truncate` is set (default), addresses
 * longer than 14 characters render as `first6…last6` with the full address
 * available via `title` and `aria-label` so assistive tech and hover still
 * expose the canonical string.
 *
 * @param {object} props
 * @param {string} props.address
 * @param {boolean} [props.truncate]
 * @param {'sm' | 'md'} [props.size]
 */
export function AddressText({ address, truncate = true, size = 'md' }) {
    const display =
        truncate && address.length > 14
            ? `${address.slice(0, 6)}…${address.slice(-6)}`
            : address;
    return (
        <span
            className={`${styles.addr} ${styles[size]}`}
            title={address}
            aria-label={address}
        >
            {display}
        </span>
    );
}
