import styles from './StatusMessage.module.css';

/**
 * §53.3 / G169 — shared status / error / success row that every form can
 * use in place of an unannounced `<p>` or `<div>`. Picks the right
 * `role` + `aria-live` per variant so screen readers announce the
 * message exactly once when it appears.
 *
 *   variant="status"   role="status" aria-live="polite"  — neutral progress / informational copy
 *   variant="error"    role="alert"  aria-live="assertive" — validation failure / runtime error
 *   variant="success"  role="status" aria-live="polite"  — confirmation copy after a successful action
 *
 * Renders nothing when `children` is empty, so callers can mount the
 * component conditionally inside an effect-driven flow without an
 * extra null branch.
 *
 * @param {object} props
 * @param {'status' | 'error' | 'success'} [props.variant]   default 'status'
 * @param {string} [props.id]
 * @param {import('react').ReactNode} props.children
 * @param {string} [props.className]                          appended after the variant class so callers can space-suffix layout adjustments
 */
export function StatusMessage({ variant = 'status', id, children, className }) {
    if (children === null || children === undefined || children === '') return null;
    const role = variant === 'error' ? 'alert' : 'status';
    const live = variant === 'error' ? 'assertive' : 'polite';
    const variantClass = variant === 'error'
        ? styles.error
        : variant === 'success'
            ? styles.success
            : styles.status;
    const classNames = [styles.row, variantClass, className].filter(Boolean).join(' ');
    return (
        <div role={role} aria-live={live} id={id} className={classNames}>
            {children}
        </div>
    );
}
