import { useState } from 'react';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './TabsSection.module.css';

function Tabs({ items, value, onChange }) {
    return (
        <div className={styles.tabsRow} role="tablist">
            {items.map((t) => {
                const active = value === t.id;
                return (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange(t.id)}
                        className={`${styles.tab} ${active ? styles.tabActive : ''}`}
                    >
                        <span className={styles.tabLabel}>{t.label}</span>
                        {typeof t.count === 'number' ? (
                            <span className={styles.tabCount}>{t.count}</span>
                        ) : null}
                    </button>
                );
            })}
        </div>
    );
}

export function TabsSection() {
    const [homeTab, setHomeTab] = useState('balances');
    const [tokenTab, setTokenTab] = useState('info');
    return (
        <Section
            id="tabs"
            title="Tabs (page-level)"
            tag="CANONICAL underline tab strip"
            kicker="Larger, bolder tabs with an accent-colored active state — used as the primary navigation inside a routed panel (Home's Balances / Activity / DeFi, TokenDetail's Info / Market / Holders). Distinct from the pill-segmented selector, which is for inline filters."
        >
            <Guidance
                what={<>A horizontal row of transparent buttons; the active tab gets <code>color: var(--xc-accent-primary)</code> and a 2px accent underline. Optional count badge on the right of each label — accent-tinted gray by default, inverted to accent-primary background with white text when the tab is active.</>}
                when={<>Inside a routed panel where the user is switching VIEWS of the same record (Token detail's tabs over one token) or VIEWS of a related collection (Home tabs over the wallet). Tabs live at the top of the panel content, NOT in the ScreenHeader.</>}
                whenNot={<>For mutually-exclusive inline filters (All / Coins / Tokens) → use the <a href="#pill-segmented">pill segmented selector</a> instead. For deep navigation (different sections of the app) → use the left-nav / pancake-menu, not tabs.</>}
                sizing={<>Each tab: <code>padding: var(--xc-space-3) var(--xc-space-3)</code>, <code>font-size: var(--xc-text-sm)</code>, weight 600. Active underline: <code>border-bottom: 2px solid var(--xc-accent-primary)</code>. Count badge: 11px / weight 700 in a pill with 1px 7px padding. Row sits on a 1px hairline border-bottom matching the tab underline thickness so inactive tabs read as flush with the row baseline.</>}
                doRule={<>✓ Use this for primary panel-internal navigation · keep labels short (one or two words) · include counts when the data is countable and useful (Activity badges, Holders) · sort tabs in stable order — frequency of use OR information progression</>}
                dontRule={<>✗ Use tabs as filters that exclude data (filters belong in the pill-segmented or the chip-filter row) · nest tabs inside tabs (use sub-tabs sparingly via the pill-segmented in a tab panel) · drop the underline in favor of a background fill (the underline is the visual signature)</>}
                supersedes={<>The <code>.tab</code> / <code>.tabActive</code> rules in <code>HomeTabs.module.css</code> and <code>TokenDetail.module.css</code>. Lift to a shared <code>&lt;Tabs&gt;</code> component once a third caller appears.</>}
            />

            <Markup>
{`<div className={styles.tabsRow} role="tablist">
    {ITEMS.map((t) => (
        <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => onChange(t.id)}
            className={\`\${styles.tab} \${active === t.id ? styles.tabActive : ''}\`}
        >
            <span className={styles.tabLabel}>{t.label}</span>
            {t.count != null ? <span className={styles.tabCount}>{t.count}</span> : null}
        </button>
    ))}
</div>`}
            </Markup>

            <LiveExample label="Home tabs — with count badges">
                <Tabs
                    value={homeTab}
                    onChange={setHomeTab}
                    items={[
                        { id: 'balances', label: 'Balances', count: 12 },
                        { id: 'activity', label: 'Activity', count: 3 },
                        { id: 'defi', label: 'DeFi', count: 0 },
                    ]}
                />
            </LiveExample>

            <LiveExample label="Token detail — no counts">
                <Tabs
                    value={tokenTab}
                    onChange={setTokenTab}
                    items={[
                        { id: 'info', label: 'Info' },
                        { id: 'market', label: 'Market' },
                        { id: 'holders', label: 'Holders' },
                    ]}
                />
            </LiveExample>
        </Section>
    );
}
