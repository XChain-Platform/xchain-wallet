// Shared layout primitives for the §35 Settings panels. Extracted so
// each section gets the same row chrome / status fallback / toggle
// styling without restating the inline-style blob 14 times.
//
// Underscore prefix marks this as internal to `components/settings/`;
// other directories shouldn't import from here.

export const ROW = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    background: 'var(--xc-surface-raised)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    fontSize: 'var(--xc-text-sm)',
    gap: 'var(--xc-space-3)',
};
export const STACK = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-1)',
};
export const ROW_LABEL = { color: 'var(--xc-text-muted)' };
export const ROW_VALUE = { color: 'var(--xc-text)', fontWeight: 500 };
export const ROW_HINT = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    marginTop: 2,
    lineHeight: 1.3,
};
export const SELECT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};
export const INPUT = {
    background: 'var(--xc-bg)',
    color: 'var(--xc-text)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: 'var(--xc-space-1) var(--xc-space-2)',
    fontSize: 'var(--xc-text-sm)',
    fontFamily: 'inherit',
};

/**
 * Two-column row with a label + hint on the left and an `<input
 * type="checkbox">` styled as a toggle on the right.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {string} [props.hint]
 * @param {boolean} props.checked
 * @param {(next: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export function ToggleRow({ label, hint, checked, onChange, disabled }) {
    return (
        <div style={ROW}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--xc-text)', fontWeight: 500 }}>{label}</span>
                {hint ? <span style={ROW_HINT}>{hint}</span> : null}
            </div>
            <input
                type="checkbox"
                role="switch"
                aria-label={label}
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                style={{
                    width: 36,
                    height: 20,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                }}
            />
        </div>
    );
}

/**
 * @param {object} props
 * @param {string} props.text
 * @param {'error'|'muted'} [props.tone]
 */
export function Status({ text, tone }) {
    return (
        <div style={{
            padding: 'var(--xc-space-3) var(--xc-space-4)',
            background: 'var(--xc-surface-raised)',
            border: tone === 'error'
                ? '1px solid var(--xc-error, #c33)'
                : '1px dashed var(--xc-border)',
            borderRadius: 'var(--xc-radius-md)',
            color: tone === 'error' ? 'var(--xc-error, #c33)' : 'var(--xc-text-muted)',
            fontSize: 'var(--xc-text-sm)',
        }}>
            {text}
        </div>
    );
}
