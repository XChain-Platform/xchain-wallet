import { useState } from 'react';
import { Screen, Button, ChainBadge } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { resolveApproval } from '../messaging.js';
import shared from '../approval.module.css';
import styles from './ConnectApproval.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * Connect approval — §43.3 / §43.4. Grants a dApp the right to call
 * `getAccounts` / `getBalances` / etc. against the permitted chains.
 *
 * Defaults favour the user:
 *   - Chains pre-select the dApp's requested set if present; otherwise
 *     an empty selection (user must opt in to each chain).
 *   - Message-signing permission defaults to OFF — dApps that want it
 *     can still request signMessage later, which triggers a per-request
 *     approval the first time (and a per-origin "always allow" opt-in).
 *   - `canSignAction` starts empty — action-kind permissions are gated
 *     inside the signAction flow with its own "always allow" toggle.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {any} props.payload  ConnectApprovalRequest
 * @param {() => void} props.onReject
 */
export function ConnectApproval({ id, payload, onReject }) {
    const origin = payload?.origin || '';
    const appName = payload?.appName || origin;
    const requestedChains = Array.isArray(payload?.requestedChains)
        ? payload.requestedChains
        : [];
    const requestedAccounts = Array.isArray(payload?.requestedAccounts)
        ? payload.requestedAccounts
        : [];

    const supported = chainRegistry.supportedChains();
    const initialChains = requestedChains.length > 0
        ? supported
            .filter((d) => requestedChains.includes(d.id))
            .map((d) => d.id)
        : [];

    const [approvedChains, setApprovedChains] = useState(initialChains);
    const [canSignMessage, setCanSignMessage] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    function toggleChain(chainId) {
        setApprovedChains((prev) =>
            prev.includes(chainId)
                ? prev.filter((c) => c !== chainId)
                : [...prev, chainId],
        );
    }

    async function handleApprove() {
        if (busy || approvedChains.length === 0) return;
        setBusy(true);
        setError(null);
        try {
            await resolveApproval(id, {
                approved: true,
                chains: approvedChains,
                accounts: requestedAccounts,
                canSignMessage,
                canSignAction: {},
            });
            // Broker closes the window on resolve; call window.close as a
            // belt-and-braces in case the browser doesn't honour remove().
            window.close();
        } catch (err) {
            setError(err?.message || 'Approval failed.');
            setBusy(false);
        }
    }

    return (
        <Screen
            variant="popup"
            header={
                <div className={shared.header}>
                    <span className={shared.title}>Connection request</span>
                    <span className={shared.origin}>{origin}</span>
                </div>
            }
            footer={
                <div className={shared.footer}>
                    <Button variant="ghost" block onClick={onReject} disabled={busy}>
                        Reject
                    </Button>
                    <Button
                        variant="primary"
                        block
                        onClick={handleApprove}
                        loading={busy}
                        disabled={approvedChains.length === 0}
                    >
                        Connect
                    </Button>
                </div>
            }
        >
            <p className={styles.lede}>
                <strong>{appName}</strong> wants to connect to your wallet.
            </p>

            <fieldset className={styles.fieldset}>
                <legend className={styles.legend}>Chains</legend>
                <p className={styles.hint}>
                    Pick which chains {appName} can see. You can change this later.
                </p>
                <ul className={styles.chainList}>
                    {supported.map((d) => {
                        const checked = approvedChains.includes(d.id);
                        return (
                            <li key={d.id} className={styles.chainRow}>
                                <label className={styles.chainLabel}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleChain(d.id)}
                                        aria-label={`Allow ${d.displayName} ${d.networkKind}`}
                                    />
                                    <ChainBadge descriptor={d} size="sm" />
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </fieldset>

            <label className={shared.toggleRow}>
                <input
                    type="checkbox"
                    checked={canSignMessage}
                    onChange={(e) => setCanSignMessage(e.target.checked)}
                />
                <span>Allow {appName} to request message signatures</span>
            </label>

            {error ? <div className={shared.error} role="alert">{error}</div> : null}
        </Screen>
    );
}
