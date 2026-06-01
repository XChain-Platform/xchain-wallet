// WalletModeSection — §20 wallet-mode selector (G039).
//
// Lets the user pick between three modes:
//   - full    Sign + broadcast on this device. Default.
//   - watcher Watch-only — builds unsigned PSBTs for an air-gapped signer.
//   - signer  Air-gapped signer — accepts pasted PSBTs, returns signed.
//
// Step 1 of 3: this section ships the selector + persistence only.
// Send.jsx watcher branch (G040) and Home.jsx signer variant (G041) read
// the field in subsequent steps; until those land the field is stored
// but doesn't yet alter behavior. The hint copy says so.

import { useSettings } from '../../hooks/useSettings.js';
import { WALLET_MODES, WALLET_MODE_DEFAULT } from '../../../schemas/settings.js';
import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const MODE_OPTIONS = /** @type {const} */ ([
    {
        value: 'full',
        label: 'Full',
        hint: 'Standard. Sign and broadcast transactions on this device.',
    },
    {
        value: 'watcher',
        label: 'Watcher (watch-only)',
        hint: 'View balances and build unsigned transactions. Pair with a separate signer-mode wallet to sign.',
    },
    {
        value: 'signer',
        label: 'Signer (air-gapped)',
        hint: 'Sign transactions pasted in from a watcher wallet. Send / receive screens are hidden — this wallet does not broadcast.',
    },
]);

export function WalletModeSection() {
    const { settings, loading, error, update } = useSettings();

    if (loading) return <Status text="Loading…" />;
    if (error) return <Status text={`Settings unavailable: ${error.message}`} tone="error" />;
    if (!settings) return <Status text="Settings unavailable." tone="error" />;

    const current = WALLET_MODES.includes(settings.walletMode)
        ? settings.walletMode
        : WALLET_MODE_DEFAULT;

    const onChange = async (next) => {
        if (!WALLET_MODES.includes(next)) return;
        if (next === current) return;
        try { await update({ walletMode: next }); } catch (err) {
            // eslint-disable-next-line no-console
            console.error('walletMode update failed:', err);
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
                Choose how this wallet handles transactions. Watcher and Signer are paired modes for air-gapped signing.
            </legend>
            {MODE_OPTIONS.map((opt) => (
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
                        name="walletMode"
                        value={opt.value}
                        checked={current === opt.value}
                        onChange={() => onChange(opt.value)}
                        aria-describedby={`walletMode-${opt.value}-hint`}
                        style={{
                            marginTop: 2,
                            marginInlineEnd: 'var(--xc-space-2)',
                            cursor: 'pointer',
                            flexShrink: 0,
                        }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                        <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{opt.label}</span>
                        <span id={`walletMode-${opt.value}-hint`} style={ROW_HINT}>
                            {opt.hint}
                        </span>
                    </span>
                </label>
            ))}
        </fieldset>
    );
}
