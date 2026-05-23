import { Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './AccentBorderedCardSection.module.css';

export function AccentBorderedCardSection() {
    return (
        <Section
            id="solid-accent-card"
            title="Solid accent card (the blue box)"
            tag="CANONICAL hero / primary-figure card"
            kicker="A solid-fill brand-blue card with white text — the visual peak of a screen. Used for the Total Balance hero at the top of Home; reuse anywhere the page has ONE primary figure (a balance, a result, a status) the user should anchor on."
        >
            <Guidance
                what={<>A card filled with a top-to-bottom gradient from <code>--xc-accent-primary</code> at the top to an 80%-mixed-with-black darker shade at the bottom. White text on top. Soft outer drop-shadow tinted with the accent (<code>rgba(30,144,199,0.25)</code>) so the card visibly floats above the surface beneath it.</>}
                when={<>The single most important figure on a screen — total balance on Home, a deal-closing summary on a confirmation screen, the "you are here" status on an in-flight transaction. Use ONCE per screen.</>}
                whenNot={<>Default grouping → <a href="#gray-card">gray surface card</a>. Highlighted-but-not-primary cards (the portfolio chart wrap, the quick-action tiles) → the outlined accent-border variant (Quick-action card pattern). Status callouts (error / warning / success) → tinted status colors, not the brand fill.</>}
                sizing={<>Padding usually compact: <code>var(--xc-space-2) var(--xc-space-3)</code> (8/12px) — the card is short and wide, prioritizing the figure inside. Radius <code>var(--xc-radius-md)</code>. Box-shadow <code>0 6px 18px rgba(30, 144, 199, 0.25)</code>. White text uses opacity stops: 100% for the figure, ~85% for the label, ~60% for the scope/sub.</>}
                variants={<>Inline action buttons (eye toggle for "balances hidden", refresh, etc.) render as 28×28 round buttons with <code>background: rgba(255,255,255,0.15)</code> and white SVG inside. Hover bumps the white fill to 0.25.</>}
                doRule={<>✓ Reserve for the ONE primary figure on a page · always pair with white text so contrast stays AAA · use the gradient (not a flat fill) — the depth signal is what makes it read as "hero" · tint the box-shadow with the accent so it feels glowy, not generic-card-drop-shadow</>}
                dontRule={<>✗ Use a solid flat fill instead of the gradient (loses the hero depth) · use this for secondary cards (defeats the "one peak per page" rule) · put dark text on it (breaks the white-on-blue identity)</>}
                supersedes={<>The <code>.hero</code> rule in <code>TotalBalanceHero.module.css</code>. Lift to a shared <code>&lt;AccentHeroCard&gt;</code> in <code>@xchain-wallet/core/ui</code> when a second caller appears.</>}
            />

            <Markup>
{`<div className={styles.hero}>
    <div className={styles.row}>
        <span className={styles.label}>Total balance <span className={styles.scope}>· 24h</span></span>
        <button className={styles.eye} aria-label="Hide balances"><Icon.EyeIcon /></button>
    </div>
    <div className={styles.figure}>$12,345.67</div>
    <div className={styles.delta}>+$182.40 (1.5%) ▲</div>
</div>

// CSS
.hero {
    background: linear-gradient(
        180deg,
        var(--xc-accent-primary) 0%,
        color-mix(in srgb, var(--xc-accent-primary) 80%, #000) 100%
    );
    color: #FFFFFF;
    border-radius: var(--xc-radius-md);
    padding: var(--xc-space-2) var(--xc-space-3);
    box-shadow: 0 6px 18px rgba(30, 144, 199, 0.25);
}`}
            </Markup>

            <LiveExample label="Total balance hero — the canonical Home pattern">
                <div className={styles.hero}>
                    <div className={styles.row}>
                        <span className={styles.label}>
                            Total balance <span className={styles.scope}>· 24h</span>
                        </span>
                        <div className={styles.actions}>
                            <button type="button" className={styles.eye} aria-label="Hide balances">
                                <Icon.EyeIcon />
                            </button>
                            <button type="button" className={styles.eye} aria-label="Refresh">
                                <Icon.RefreshIcon />
                            </button>
                        </div>
                    </div>
                    <div className={styles.figure}>$12,345.67</div>
                    <div className={styles.delta}>+$182.40 (1.5%) ▲</div>
                </div>
            </LiveExample>

            <LiveExample label="Compact status hero — single line, no chart">
                <div className={styles.hero}>
                    <div className={styles.row}>
                        <span className={styles.label}>Transaction confirmed</span>
                        <span className={styles.label} style={{ fontWeight: 500 }}>#2,043,118</span>
                    </div>
                </div>
            </LiveExample>
        </Section>
    );
}
