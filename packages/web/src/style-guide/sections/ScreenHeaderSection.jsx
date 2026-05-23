import { ScreenHeader, Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ScreenHeaderSection() {
    return (
        <Section
            id="screen-header"
            title="Screen header"
            tag="CANONICAL secondary toolbar"
            kicker="The accent-colored back chevron · centered title (with optional accent-colored route-action icon) · optional trailing-action slot. Every routed screen below the global AppHeader uses this."
        >
            <Guidance
                what={<>A three-column layout: leading slot (back chevron or spacer), centered title group (optional <code>titleIcon</code> + label), trailing slot (filter / scan / etc., or spacer). Back chevron and title icon both render in <code>--xc-accent-primary</code> — that's where the "blue highlight headers" feeling comes from.</>}
                when={<>Every routed screen. Always use <code>&lt;ScreenHeader /&gt;</code> from <code>@xchain-wallet/core/ui</code> — never roll your own <code>.header</code> / <code>.back</code> / <code>.title</code> CSS.</>}
                doRule={<>✓ Pass <code>titleIcon</code> with the matching <code>Icon.XxxIcon</code> so the screen reads as the same action as the launching button (Send screen ↔ Send icon) · keep the trailing slot for ONE primary action — multiple actions go in a More menu</>}
                dontRule={<>✗ Roll your own header CSS · pass JSX into <code>title</code> beyond a string (breaks centering math) · use a custom-colored title icon (always accent — the visual rhythm relies on it)</>}
                supersedes={<>Per-route header CSS in older Send / Settings / Address routes (tracked in TODO.md migration list).</>}
            />

            <Markup>
{`import { ScreenHeader, Icon } from '@xchain-wallet/core/ui';

<ScreenHeader
    onBack={onBack}
    title="Send"
    titleIcon={<Icon.SendIcon />}
    trailing={<button onClick={openScan} aria-label="Scan QR"><Icon.CameraIcon /></button>}
/>`}
            </Markup>

            <LiveExample label="Send screen — title icon + trailing scan affordance">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden', background: 'var(--xc-surface)' }}>
                    <ScreenHeader
                        onBack={() => {}}
                        title="Send"
                        titleIcon={<Icon.SendIcon />}
                        trailing={<button type="button" style={{ background: 'transparent', border: 'none', color: 'var(--xc-text)', cursor: 'pointer', padding: 4 }} aria-label="Scan QR"><Icon.CameraIcon /></button>}
                    />
                </div>
            </LiveExample>

            <LiveExample label="Receive screen — bare title icon, no trailing action">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden', background: 'var(--xc-surface)' }}>
                    <ScreenHeader
                        onBack={() => {}}
                        title="Receive"
                        titleIcon={<Icon.ReceiveIcon />}
                    />
                </div>
            </LiveExample>

            <LiveExample label="No back (root view) — leading slot is a spacer">
                <div style={{ border: '1px solid var(--xc-border)', borderRadius: 'var(--xc-radius-md)', overflow: 'hidden', background: 'var(--xc-surface)' }}>
                    <ScreenHeader
                        title="Address book"
                        titleIcon={<Icon.BookIcon />}
                    />
                </div>
            </LiveExample>
        </Section>
    );
}
