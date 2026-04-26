import styles from './Screen.module.css';

/**
 * Top-level layout wrapper.
 *
 *   `variant="small"` — narrow viewport, fixed 360×600 (Chrome
 *                        extension popup, mobile browser, narrow
 *                        desktop window).
 *   `variant="full"`  — wide viewport, flexible (extension full-screen
 *                        tab, desktop browser, tablet landscape).
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.footer]
 * @param {'small' | 'full'} [props.variant]
 * @param {import('react').ReactNode} props.children
 */
export function Screen({ header, footer, variant = 'small', children }) {
    const className = `${styles.screen} ${styles[variant]}`;
    return (
        <div className={className} role="group">
            {header ? <div className={styles.header}>{header}</div> : null}
            <div className={styles.body}>{children}</div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
    );
}
