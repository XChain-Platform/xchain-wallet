import styles from './Button.module.css';

/**
 * @param {object} props
 * @param {'primary' | 'secondary' | 'ghost' | 'danger'} [props.variant]
 * @param {'sm' | 'md'} [props.size]
 * @param {boolean} [props.block]
 * @param {boolean} [props.loading]
 * @param {boolean} [props.disabled]
 * @param {'button' | 'submit' | 'reset'} [props.type]
 * @param {(e: import('react').MouseEvent<HTMLButtonElement>) => void} [props.onClick]
 * @param {import('react').ReactNode} props.children
 */
export function Button({
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    disabled = false,
    type = 'button',
    onClick,
    children,
    ...rest
}) {
    const className = [
        styles.btn,
        styles[variant],
        styles[size],
        block ? styles.block : null,
        loading ? styles.loading : null,
    ].filter(Boolean).join(' ');
    return (
        <button
            type={type}
            className={className}
            disabled={disabled || loading}
            onClick={onClick}
            aria-busy={loading ? 'true' : 'false'}
            {...rest}
        >
            {loading ? <span className={styles.spinner} aria-hidden="true" /> : null}
            <span className={styles.label}>{children}</span>
        </button>
    );
}
