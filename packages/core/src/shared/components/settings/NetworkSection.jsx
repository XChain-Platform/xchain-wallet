// NetworkSection — active-network picker.
//
// Switches the wallet between Mainnet / Testnet / Regtest. Chains on
// the inactive networks stay configured but go dormant: no balance
// polling, no history fetches, no reachability checks, no SDK round-
// trips. Switching back is instant; cached data isn't wiped, so it
// reappears as soon as the filter flips.
//
// Cross-network features (LINK / SWAP spanning networks) are
// structurally impossible while the filter is on — that's a
// clarification rather than a regression since cross-mainnet-testnet
// bridges don't exist anyway.
//
// After a flip we reload the page. Many components fetch their chain-
// scoped state once in a useEffect keyed only on (walletId, accountId)
// and won't re-derive when settings.activeNetwork changes. A reload is
// the cheapest robust path to a fully consistent post-switch UI. The
// operation is rare (this is a dev-oriented affordance) and the user
// just made a deliberate choice, so a reload doesn't surprise them.

import { useSettings } from '../../hooks/useSettings.js';
import { NETWORKS, NETWORK_DEFAULT } from '../../../schemas/settings.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const NETWORK_OPTIONS = /** @type {const} */ ([
    {
        value: 'mainnet',
        label: 'Mainnet',
        hint: 'Real funds on the production blockchains. The everyday default.',
    },
    {
        value: 'testnet',
        label: 'Testnet',
        hint: 'Public testnets for each chain (testnet3 / litecoin testnet / dogecoin testnet). Coins have no real value.',
    },
    {
        value: 'regtest',
        label: 'Regtest',
        hint: 'Local regression-test networks for development. Requires a regtest node running on your machine or LAN.',
    },
]);

export function NetworkSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = NETWORKS.includes(settings.activeNetwork)
        ? settings.activeNetwork
        : NETWORK_DEFAULT;

    const onChange = async (next) => {
        if (!NETWORKS.includes(next)) return;
        if (next === current) return;
        try {
            await update({ activeNetwork: next });
            // Components that pulled their chain-scoped state on mount
            // (Home / History / AddressList / Send / every action form)
            // won't re-fetch on settings change. A reload guarantees a
            // fully consistent post-switch UI without per-component
            // refresh wiring.
            if (typeof window !== 'undefined') window.location.reload();
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('activeNetwork update failed:', err);
        }
    };

    return (
        <fieldset
            style={{
                ...STACK,
                border: 'none',
                padding: 0,
                margin: 0,
            }}
        >
            <legend
                style={{
                    color: 'var(--xc-text-muted)',
                    fontSize: 'var(--xc-text-xs)',
                    marginBottom: 'var(--xc-space-1)',
                }}
            >
                The wallet shows balances, history, and chain pickers only for the selected network. Switching does not delete any wallet data — chains on the other networks stay configured and reappear when you switch back. The page reloads on change.
            </legend>
            {NETWORK_OPTIONS.map((opt) => (
                <label
                    key={opt.value}
                    style={{
                        ...ROW,
                        alignItems: 'flex-start',
                        cursor: 'pointer',
                    }}
                >
                    <input
                        type="radio"
                        name="activeNetwork"
                        value={opt.value}
                        checked={current === opt.value}
                        onChange={() => onChange(opt.value)}
                        aria-describedby={`activeNetwork-${opt.value}-hint`}
                        style={{
                            marginTop: 2,
                            marginInlineEnd: 'var(--xc-space-2)',
                            cursor: 'pointer',
                            flexShrink: 0,
                        }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{opt.label}</span>
                        <span id={`activeNetwork-${opt.value}-hint`} style={ROW_HINT}>
                            {opt.hint}
                        </span>
                    </span>
                </label>
            ))}
        </fieldset>
    );
}
