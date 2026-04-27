import styles from './Screen.module.css';

const MAIN_ID = 'xc-main';

/**
 * Top-level layout wrapper.
 *
 *   `variant="small"` — narrow viewport, fixed 360×600 (Chrome
 *                        extension popup, mobile browser, narrow
 *                        desktop window).
 *   `variant="full"`  — wide viewport, flexible (extension full-screen
 *                        tab, desktop browser, tablet landscape).
 *
 * §53.1 / G167 — first focusable element on every screen is a skip-to-main
 * link that's visually hidden until focused. Tab once on any screen and
 * the link appears; Enter jumps focus past the header into the body.
 *
 * §53.2 / G168 — header / main / footer use the right semantic elements
 * so screen readers can navigate by landmark instead of having to walk
 * the entire DOM each screen.
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
        <div className={className}>
            <a href={`#${MAIN_ID}`} className={styles.skipLink}>
                Skip to main content
            </a>
            {header ? <header className={styles.header}>{header}</header> : null}
            <main id={MAIN_ID} tabIndex={-1} className={styles.body}>
                {children}
            </main>
            {footer ? <footer className={styles.footer}>{footer}</footer> : null}
        </div>
    );
}
