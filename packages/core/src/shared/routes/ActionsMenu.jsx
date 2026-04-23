import { Screen, Button } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './ActionsMenu.module.css';

/**
 * Actions menu — secondary authoring surface listed in §40.
 *
 * Home keeps the common three actions (Send / Receive / Create a token)
 * above the fold; everything else (standalone ISSUE §40.2, MINT §40.3,
 * DESTROY §40.4, token admin §40.5, BROADCAST §40.6, dispenser §40.7.1,
 * …) lands here. Until the Token detail page (§36 / §33) exists, this
 * menu also plays the role those per-token menus will eventually play.
 *
 * Entries are passed in as a prop so each host (popup, web) can choose
 * which items to surface and wire each one to its own sub-route.
 *
 * @typedef {{ id: string, label: string, description?: string, onSelect: () => void, disabled?: boolean }} ActionEntry
 *
 * @param {object} props
 * @param {ActionEntry[]} props.entries
 * @param {() => void} props.onBack
 */
export function ActionsMenu({ entries, onBack }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const header = (
        <div className={styles.header}>
            <button
                type="button"
                onClick={onBack}
                className={styles.back}
                aria-label="Back to home"
            >
                ← Back
            </button>
            <span className={styles.title}>Actions</span>
            <span className={styles.spacer} />
        </div>
    );

    return (
        <Screen variant={variant} header={header}>
            <div className={isFull ? styles.listFull : styles.listPopup}>
                {entries.map((e) => (
                    <button
                        key={e.id}
                        type="button"
                        className={styles.entry}
                        onClick={e.onSelect}
                        disabled={e.disabled}
                    >
                        <span className={styles.entryLabel}>{e.label}</span>
                        {e.description ? (
                            <span className={styles.entryDescription}>{e.description}</span>
                        ) : null}
                    </button>
                ))}
            </div>
            <div className={styles.actions}>
                <Button variant="ghost" onClick={onBack}>Back</Button>
            </div>
        </Screen>
    );
}
