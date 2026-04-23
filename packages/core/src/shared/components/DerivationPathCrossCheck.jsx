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
 * The wallet explicitly instructs the user to compare the on-device
 * summary to the values shown here. This protects against a
 * compromised host asking the device to sign for a different address
 * than the UI claims (§18.5 threat).
 *
 * @param {object} props
 * @param {string} props.signerName     e.g. "Trezor Model T (My Trezor)"
 * @param {string} props.signerKind     'trezor' | 'ledger'
 * @param {string} props.path           concrete BIP32 path
 * @param {string} props.address        the address the signature will be produced from
 */
export function DerivationPathCrossCheck({ signerName, signerKind, path, address }) {
    const deviceLabel = signerKind === 'trezor'
        ? 'Trezor'
        : signerKind === 'ledger' ? 'Ledger' : 'your device';

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
                Verify the address shown on your <strong>{deviceLabel}</strong> matches the address shown here.
                If they don't match, reject on the device.
            </p>
        </section>
    );
}
