import styles from './Screen.module.css';

/**
 * Top-level layout wrapper. `variant="popup"` is a fixed 360×600 MV3 popup
 * (§8.1 target #3); `variant="full"` is the flexible layout used by the
 * extension's full-screen tab (§8.1 target #4) and the web SPA (target #1).
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.header]
 * @param {import('react').ReactNode} [props.footer]
 * @param {'popup' | 'full'} [props.variant]
 * @param {import('react').ReactNode} props.children
 */
export function Screen({ header, footer, variant = 'popup', children }) {
    const className = `${styles.screen} ${styles[variant]}`;
    return (
        <div className={className} role="group">
            {header ? <div className={styles.header}>{header}</div> : null}
            <div className={styles.body}>{children}</div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
    );
}
