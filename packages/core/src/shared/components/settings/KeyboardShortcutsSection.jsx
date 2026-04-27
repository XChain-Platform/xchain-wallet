// KeyboardShortcutsSection — §35.1 Keyboard Shortcuts panel.
//
// The §34 keyboard-shortcut system is not yet implemented per the
// 2026-04-26 gap audit (no global useKeyboardShortcuts hook, no
// dispatch table, no rebind UI). This panel ships a read-only
// preview of the shortcut surface the spec calls for so users (and
// future contributors) can see what's planned without a separate
// docs page. Per-binding rebind controls land when the underlying
// system arrives.

import { ROW, ROW_HINT, STACK, Status } from './_settingsPrimitives.jsx';

const PLANNED_SHORTCUTS = /** @type {const} */ ([
    { keys: '?',          action: 'Show keyboard shortcut help overlay' },
    { keys: 'Cmd / Ctrl + K', action: 'Open command palette (§33)' },
    { keys: 'Esc',        action: 'Close modal / cancel current input' },
    { keys: 'g h',        action: 'Go to home' },
    { keys: 'g a',        action: 'Go to addresses' },
    { keys: 'g c',        action: 'Go to contacts' },
    { keys: 'g s',        action: 'Go to settings' },
    { keys: 'n s',        action: 'New send' },
    { keys: 'n r',        action: 'New receive (next address)' },
    { keys: 'l',          action: 'Lock wallet immediately' },
]);

const KEYBOARD_KBD = {
    fontFamily: 'var(--xc-font-mono, monospace)',
    fontSize: 'var(--xc-text-xs)',
    background: 'var(--xc-bg)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    padding: '1px 6px',
    color: 'var(--xc-text)',
};

export function KeyboardShortcutsSection() {
    return (
        <div style={STACK}>
            <Status text="Rebind controls land when the §34 keyboard system ships. The list below shows the planned bindings." />
            {PLANNED_SHORTCUTS.map((s) => (
                <div key={s.keys} style={ROW}>
                    <span style={KEYBOARD_KBD}>{s.keys}</span>
                    <span style={{ color: 'var(--xc-text)', fontSize: 'var(--xc-text-sm)', flex: 1, marginLeft: 'var(--xc-space-3)' }}>
                        {s.action}
                    </span>
                    <span style={ROW_HINT}>not yet active</span>
                </div>
            ))}
        </div>
    );
}
