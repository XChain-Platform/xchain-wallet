import { useState, useEffect } from 'react';
import { AddressText } from '@xchain-wallet/core/ui';
import styles from './DerivationPathCrossCheck.module.css';

/**
 * DerivationPathCrossCheck — §18.5. Reusable UI block that sits above
 * a sign button when the signer is a hardware device. Displays the
 * three facts the user must confirm against the device screen, then
 * the explicit cross-check instruction copy.
 *
 * Rendered by sign screens (shared SignApproval, the wallet's own
 * send/issue/etc. review stages) whenever `signer.kind` is `trezor`
 * or `ledger`. Does not render anything for software signers — those
 * have no physical confirmation step.
 *
 * The wallet explicitly instructs the user to compare BOTH the
 * derivation path AND the address shown on the device against the
 * values rendered here. This protects against a compromised host
 * asking the device to sign for a different address (or a different
 * sub-account at a different path) than the UI claims (§18.5 threat).
 *
 * Per-vendor hint copy describes what the device actually displays so
 * users without prior HW experience know where to look:
 *   - Trezor screens always show address + path side-by-side on the
 *     confirmation step.
 *   - Ledger Nano S Plus / Nano X / Stax show the address (path on a
 *     secondary screen accessible via the right button on Nano models).
 *
 * @param {object} props
 * @param {string} props.signerName     e.g. "Trezor Model T (My Trezor)"
 * @param {string} props.signerKind     'trezor' | 'ledger'
 * @param {string} props.path           concrete BIP32 path
 * @param {string} props.address        the address the signature will be produced from
 * @param {boolean} [props.requireExplicitConfirm]   when true, render an "I've verified path + address" checkbox; parent reads value via onConfirmedChange. Defaults to false (instruction copy only).
 * @param {(confirmed: boolean) => void} [props.onConfirmedChange]   fired when the explicit-confirm checkbox toggles
 */
export function DerivationPathCrossCheck({
    signerName,
    signerKind,
    path,
    address,
    requireExplicitConfirm,
    onConfirmedChange,
}) {
    const deviceLabel = signerKind === 'trezor'
        ? 'Trezor'
        : signerKind === 'ledger' ? 'Ledger' : 'your device';

    const [confirmed, setConfirmed] = useState(false);

    // Reset the checkbox whenever the path or address changes — the user
    // must re-confirm if the values they were verifying have rotated under
    // them. Safer than carrying a stale "yes I verified" through a route
    // change.
    useEffect(() => {
        setConfirmed(false);
        onConfirmedChange?.(false);
    }, [path, address, onConfirmedChange]);

    function handleToggle(event) {
        const next = event.target.checked;
        setConfirmed(next);
        onConfirmedChange?.(next);
    }

    return (
        <section className={styles.root} aria-label="Hardware signer verification">
            <p className={styles.title}>Signing with hardware device</p>
            <dl className={styles.grid}>
                <dt className={styles.label}>Signer</dt>
                <dd className={styles.value}>{signerName}</dd>
                <dt className={styles.label}>Derivation path</dt>
                <dd className={styles.value}><code className={styles.path}>{path}</code></dd>
                <dt className={styles.label}>Address</dt>
                <dd className={styles.value}><AddressText address={address} /></dd>
            </dl>
            <p className={styles.instruction}>
                Verify <strong>both</strong> the derivation path <strong>and</strong> the address shown on your <strong>{deviceLabel}</strong> match the values shown here.
                If either differs, reject on the device.
            </p>
            <p className={styles.deviceHint}>
                {signerKind === 'trezor'
                    ? 'Trezor displays the address and the derivation path side-by-side on the confirmation screen.'
                    : signerKind === 'ledger'
                    ? 'Ledger displays the address on the main screen. On Nano models, press the right button to step through to the path; on Stax, the path appears below the address.'
                    : 'Step through the device screens to compare both values.'}
            </p>
            {requireExplicitConfirm ? (
                <label className={styles.confirmRow}>
                    <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={handleToggle}
                        className={styles.confirmCheckbox}
                    />
                    <span>I've verified the path and address on my {deviceLabel}.</span>
                </label>
            ) : null}
        </section>
    );
}
