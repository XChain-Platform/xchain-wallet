import { Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './QuickActionSection.module.css';

function QuickAction({ icon, label, onClick }) {
    return (
        <button type="button" className={styles.quickAction} onClick={onClick}>
            <span className={styles.quickActionIcon} aria-hidden="true">{icon}</span>
            <span>{label}</span>
        </button>
    );
}

export function QuickActionSection() {
    return (
        <Section
            id="quick-action"
            title="Quick-action card"
            tag="CANONICAL primary-CTA tile"
            kicker="Squared card with an accent-tinted round icon on top and a short label below. The Send / Receive / Swap / More row on Home is the original; reuse this same shape any time a row offers a short list of primary actions."
        >
            <Guidance
                what={<>An accent-bordered card (1px solid <code>--xc-accent-primary</code>, 8px radius) with an accent-tinted (~12% mix) round icon halo on top and a 12px-uppercase-weight-600 label below. Always at least 72px tall so the icon + label have breathing room.</>}
                when={<>Top of a page that exposes 2–4 primary actions on a single row (Home quick actions, future onboarding action grids). Grid is <code>repeat(N, 1fr)</code> with 8px gap so the cards span the row.</>}
                whenNot={<>Single-action contexts → use <code>&lt;Button variant="primary"&gt;</code>. Long lists → use a vertical card stack or a more list. Toolbar actions (filter / scan / etc.) → use the <code>ScreenHeader</code> trailing slot.</>}
                sizing={<>Card: <code>padding: var(--xc-space-3) var(--xc-space-1)</code>, <code>min-height: 72px</code>. Icon halo: 32×32, circular, accent-tinted bg, accent-colored glyph. Label: <code>var(--xc-text-xs)</code>, weight 600.</>}
                doRule={<>✓ Always pair an Icon with a label (icon-only loses meaning; label-only loses scannability) · keep all four cards the same height (let the grid stretch the cell — don't size the button itself) · use the same <code>Icon.XxxIcon</code> already in the icon catalog so the affordance reads consistently with the rest of the app</>}
                dontRule={<>✗ Mix icon styles (emoji vs SVG) within the row · pad the label so it wraps two lines · drop the accent border in favor of a filled background (the outline+halo is the look)</>}
                supersedes={<>Inline ad-hoc CTA cards. The canonical source is <code>packages/core/src/shared/routes/Home.module.css</code> (<code>.quickAction</code> / <code>.quickActionIcon</code>) — extract to <code>QuickAction</code> in <code>@xchain-wallet/core/ui</code> next time a third caller appears.</>}
            />

            <Markup>
{`<div className={styles.quickActions}>
    <button type="button" className={styles.quickAction} onClick={onSend}>
        <span className={styles.quickActionIcon} aria-hidden="true"><Icon.SendIcon /></span>
        <span>Send</span>
    </button>
    {/* ... Receive / Swap / More ... */}
</div>`}
            </Markup>

            <LiveExample label="4-up row — Home's canonical quick actions">
                <div className={styles.quickActions}>
                    <QuickAction icon={<Icon.SendIcon />} label="Send" />
                    <QuickAction icon={<Icon.ReceiveIcon />} label="Receive" />
                    <QuickAction icon={<Icon.SwapIcon />} label="Swap" />
                    <QuickAction icon={<Icon.MoreIcon />} label="More" />
                </div>
            </LiveExample>

            <LiveExample label="2-up row — works the same with fewer actions">
                <div className={styles.quickActionsTwo}>
                    <QuickAction icon={<Icon.ScanIcon />} label="Scan QR" />
                    <QuickAction icon={<Icon.BookIcon />} label="Contacts" />
                </div>
            </LiveExample>
        </Section>
    );
}
