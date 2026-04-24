// SignCredentials — shared sign-screen block that switches between
// the software-wallet password input and the hardware-signer
// `HwSignBlock` based on `fromAddress.source`. Every review/sign
// form in the wallet renders this; the form owns the Submit button
// + flow wiring, but the credential-gathering UX is identical.
//
// Exposes status via the `onStatusChange` callback so forms can
// gate their Submit button on `status === 'available'` for HW
// sources. For software sources the status is implicit in whether
// the user has typed a password.
//
// Usage:
//
//   <SignCredentials
//       fromAddress={fromAddress}
//       chainId={chainId}
//       password={password}
//       onPasswordChange={setPassword}
//       onStatusChange={setHwStatus}
//       passwordRef={passwordRef}
//       submitError={submitError}
//       disabled={stage === 'submitting'}
//       getSignerStatus={messaging.getSignerStatus}
//   />

import { Input } from '../../ui/index.js';
import { HwSignBlock } from './HwSignBlock.jsx';

/**
 * @param {object} props
 * @param {{ address: string, source?: string, signerId?: string, signerLabel?: string, derivationPath?: string | null }} props.fromAddress
 * @param {string} [props.chainId]
 * @param {string} [props.password]
 * @param {(next: string) => void} [props.onPasswordChange]
 * @param {(state: { status: string, detail: string | null, refresh: () => void }) => void} [props.onStatusChange]
 * @param {React.Ref<HTMLInputElement>} [props.passwordRef]
 * @param {string | null} [props.submitError]
 * @param {boolean} [props.disabled]
 * @param {(opts: { signerId: string, chainId?: string }) => Promise<any>} [props.getSignerStatus]
 */
export function SignCredentials({
    fromAddress,
    chainId,
    password,
    onPasswordChange,
    onStatusChange,
    passwordRef,
    submitError,
    disabled,
    getSignerStatus,
}) {
    const src = fromAddress?.source;
    const isHw = src === 'trezor' || src === 'ledger';
    if (isHw) {
        const signerKind = /** @type {'trezor'|'ledger'} */ (src);
        return (
            <HwSignBlock
                signerKind={signerKind}
                signerName={fromAddress.signerLabel || (signerKind === 'trezor' ? 'Trezor' : 'Ledger')}
                path={fromAddress.derivationPath || ''}
                address={fromAddress.address}
                chainId={chainId}
                getStatus={getSignerStatus && fromAddress.signerId
                    ? (opts) => getSignerStatus({
                        signerId: fromAddress.signerId,
                        chainId: opts?.chainId ?? chainId,
                    })
                    : null}
                onStatusChange={onStatusChange}
            />
        );
    }
    return (
        <Input
            ref={passwordRef}
            type="password"
            label="Password"
            hint="Required to sign."
            value={password || ''}
            onChange={(e) => onPasswordChange?.(e.target.value)}
            autoComplete="current-password"
            disabled={disabled}
            error={submitError || undefined}
        />
    );
}

/**
 * Helper — inspects a fromAddress to decide whether the parent form
 * should follow the HW submit path. Exported so callers can mirror
 * the detection logic in their handleSubmit without duplicating it.
 *
 * @param {{ source?: string } | null | undefined} fromAddress
 * @returns {boolean}
 */
export function isHwSource(fromAddress) {
    return fromAddress?.source === 'trezor' || fromAddress?.source === 'ledger';
}
