import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import styles from './BalanceListSection.module.css';

const BTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#F7931A"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">₿</text></svg>`,
);
const LTC_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#345D9D"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">Ł</text></svg>`,
);
const DOGE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#C2A633"/><text x="32" y="44" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="40">Ð</text></svg>`,
);
const PEPE_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#5BA84A"/><circle cx="22" cy="26" r="7" fill="white"/><circle cx="42" cy="26" r="7" fill="white"/><circle cx="22" cy="26" r="3" fill="black"/><circle cx="42" cy="26" r="3" fill="black"/><path d="M16 42 Q32 52 48 42" stroke="black" stroke-width="3" fill="none"/></svg>`,
);

function Row({ imageUrl, chainPipUrl, name, sub, qty, fiat, letter, letterBg }) {
    return (
        <button type="button" className={styles.row}>
            <div className={styles.iconWrap}>
                {imageUrl ? (
                    <img src={imageUrl} alt="" className={styles.iconImg} />
                ) : (
                    <span className={styles.iconLetter} style={{ background: letterBg, color: '#fff' }}>
                        {letter}
                    </span>
                )}
                {chainPipUrl ? (
                    <img src={chainPipUrl} alt="" className={styles.chainOverlay} />
                ) : null}
            </div>
            <div className={styles.body}>
                <div className={styles.title}>
                    <span className={styles.name}>{name}</span>
                </div>
                <div className={styles.subtitle}>{sub}</div>
            </div>
            <div className={styles.amounts}>
                <div className={styles.qty}>{qty}</div>
                {fiat ? <div className={styles.fiat}>{fiat}</div> : null}
            </div>
        </button>
    );
}

export function BalanceListSection() {
    return (
        <Section
            id="balance-list"
            title="Balance / search-result list"
            tag="CANONICAL token + coin row"
            kicker="The standard list shape used everywhere the wallet shows a list of held or selectable assets — Home's Balances tab, Send picker, Receive picker, Address book token chips. Stacked asset icon on the left, name + tick in the middle, monospaced quantity + fiat on the right."
        >
            <Guidance
                what={<>A bordered card with rows separated by hairlines. Each row is a flex layout: 48×48 stacked icon → flex-1 body (name + tick subtitle) → right-aligned amount stack (mono qty + muted fiat). Rows are clickable buttons when an <code>onSelectToken</code> handler is wired through — they hover with <code>--xc-bg-muted</code>.</>}
                when={<>Any list of assets the user can act on: balances, search results, token pickers, contact-row tokens. The card surface (<code>--xc-surface</code>) wraps the row stack; rows themselves are transparent so the hover/focus rings read against the card.</>}
                whenNot={<>For history rows (more metadata, different right-side shape) → use the History entry pattern. For a single asset hero → use the asset hero pattern. For a horizontal asset selector (one currently-chosen asset) → use the asset card pattern.</>}
                sizing={<>Row padding <code>var(--xc-space-3)</code>, gap <code>var(--xc-space-3)</code> between icon/body/amounts. Icon wrap 48×48 (the row variant of the stacked asset icon). Name: weight 600 default size. Subtitle (tick): <code>--xc-text-xs</code> muted. Quantity: <code>--xc-font-mono</code>, <code>--xc-text-md</code>, weight 700. Fiat: mono, <code>--xc-text-xs</code>, muted, weight 600.</>}
                doRule={<>✓ Always pair quantity with a tick label (in the subtitle) so a number alone never sits next to a different asset's icon · use mono for both quantity AND fiat so digits line up vertically across rows · render fiat ONLY when a rate is available — don't show "$—" or zero placeholders · hide the chain pip on native rows (the icon IS the chain)</>}
                dontRule={<>✗ Add a third row of metadata (the row gets cramped) · right-align text or use mono for the name (only quantity/fiat use mono) · paint the row's background (the card's surface is enough — hover the row, not the card)</>}
                supersedes={<>The <code>.list</code> / <code>.row</code> / <code>.rowClickable</code> / <code>.iconWrap</code> / <code>.body</code> / <code>.amounts</code> rules in BalanceList.module.css and their JSX in <code>BalanceList.jsx</code>. The canonical implementation already lives there — extract no further until a list with materially different cell needs arrives.</>}
            />

            <Markup>
{`<BalanceList
    rows={rows}
    onSelectToken={openTokenDetail}
    pinnedKeys={pinnedSet}
    onTogglePin={togglePin}
    hiddenKeys={hiddenSet}
    onToggleHide={toggleHide}
    emptyTitle="No balances yet"
    onReceive={openReceive}
/>`}
            </Markup>

            <LiveExample label="Mixed list — natives + tokens with chain pip + letter-chip fallback">
                <div className={styles.list}>
                    <Row imageUrl={BTC_ICON} name="Bitcoin" sub="BTC" qty="1.23456789" fiat="$76,543.21" />
                    <Row imageUrl={PEPE_ICON} chainPipUrl={BTC_ICON} name="Pepe creature" sub="PEPECREATURE" qty="42,000" fiat="$185.40" />
                    <Row imageUrl={LTC_ICON} name="Litecoin" sub="LTC" qty="15.5" fiat="$1,234.50" />
                    <Row letter="X" letterBg="#A66CFF" chainPipUrl={LTC_ICON} name="XCP" sub="XCP" qty="800" />
                    <Row imageUrl={DOGE_ICON} name="Dogecoin" sub="DOGE" qty="12,345.67" fiat="$1,851.85" />
                </div>
            </LiveExample>

            <LiveExample label="Compact 2-row list — picker preview style">
                <div className={styles.list}>
                    <Row imageUrl={BTC_ICON} name="Bitcoin" sub="BTC" qty="0.001" />
                    <Row imageUrl={LTC_ICON} name="Litecoin" sub="LTC" qty="0.05" />
                </div>
            </LiveExample>
        </Section>
    );
}
