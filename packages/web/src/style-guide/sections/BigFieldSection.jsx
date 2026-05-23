import { useState } from 'react';
import { Input, Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './BigFieldSection.module.css';

const BIG_FIELD_STYLE = {
    fontSize: 'var(--xc-text-lg)',
    paddingTop: 'var(--xc-space-3)',
    paddingBottom: 'var(--xc-space-3)',
    paddingLeft: 'var(--xc-space-4)',
    paddingRight: '64px',
    minHeight: '48px',
};

export function BigFieldSection() {
    const [amount, setAmount] = useState('0.001');
    const [to, setTo] = useState('');
    return (
        <Section
            id="big-field"
            title="Big-field input"
            tag="CANONICAL primary form field"
            kicker="The bumped-up Input treatment for the few fields a screen really wants the user to touch — Send's Amount and To fields. Larger type, more vertical padding, and a reserved right gutter where an inline action button (Max, Address book) overlays the input edge."
        >
            <Guidance
                what={<>An <code>&lt;Input&gt;</code> with an inline style bump (<code>font-size: var(--xc-text-lg)</code>, vertical padding <code>var(--xc-space-3)</code>, <code>min-height: 48px</code>) and right padding reserved for a single absolutely-positioned action button. Wrap in a <code>position: relative</code> container so the button can anchor over the right edge.</>}
                when={<>The 1–2 primary inputs on a form — the ones a user is most likely to interact with on each page. Send's Amount + To, Receive's Amount. Other inputs on the same page stay at default size so the priority reads.</>}
                whenNot={<>Secondary inputs (memo, label, optional metadata) → default Input. Settings inputs → default. Long-form text → use a textarea variant, not big-field.</>}
                sizing={<>Right padding: ~52px for one icon-button action (Address book), ~64px for a wider text-button (Max). Action button: absolute-positioned at <code>right: var(--xc-space-2)</code>, vertically centered. Keep one action max — multi-action fields get cramped fast.</>}
                doRule={<>✓ Reserve the right gutter ONLY when an inline action is actually present · use the action that's most useful to the user on that page (Send Amount → Max; Send To → Address book; Receive Amount → none, so no gutter) · pair the inline action with the <code>Icon</code> from the canonical icon catalog</>}
                dontRule={<>✗ Stack inline action buttons (two icons on the right edge cramp the input) · use big-field for every input on the page (loses the "this is what matters" signal) · build a custom big input wrapper — always use the shared Input primitive with the inline style</>}
                supersedes={<>The inline <code>style={'{…}'}</code> bumps on Send's Amount and To fields. Lift the style fragment into a named export from Input.module.css when a third caller appears.</>}
            />

            <Markup>
{`<div className={styles.amountFieldWrap}>
    <Input
        label="Amount (BTC)"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{
            fontSize: 'var(--xc-text-lg)',
            paddingTop: 'var(--xc-space-3)',
            paddingBottom: 'var(--xc-space-3)',
            paddingLeft: 'var(--xc-space-4)',
            paddingRight: '64px',
            minHeight: '48px',
        }}
    />
    <button type="button" className={styles.maxButton} onClick={onMax}>Max</button>
</div>`}
            </Markup>

            <LiveExample label="Amount field with Max button">
                <div className={styles.fieldWrap}>
                    <Input
                        label="Amount (BTC)"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        style={BIG_FIELD_STYLE}
                    />
                    <button type="button" className={styles.maxButton}>Max</button>
                </div>
            </LiveExample>

            <LiveExample label="To field with Address-book inline action">
                <div className={styles.fieldWrap}>
                    <Input
                        label="To"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                        placeholder="Enter or paste an address or name…"
                        style={{ ...BIG_FIELD_STYLE, paddingRight: '52px' }}
                    />
                    <button type="button" className={styles.iconButton} aria-label="Open address book">
                        <Icon.BookIcon />
                    </button>
                </div>
            </LiveExample>
        </Section>
    );
}
