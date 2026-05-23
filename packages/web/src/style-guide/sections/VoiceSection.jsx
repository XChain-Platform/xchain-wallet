import { Section, Guidance, LiveExample } from '../StyleGuidePage.jsx';

function Compare({ good, bad, note }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            padding: '12px 0',
            borderBottom: '1px solid var(--xc-border)',
        }}>
            <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--xc-success)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>✓ Do</div>
                <div style={{ fontSize: 14 }}>{good}</div>
            </div>
            <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--xc-danger)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>✗ Avoid</div>
                <div style={{ fontSize: 14, color: 'var(--xc-text-muted)' }}>{bad}</div>
            </div>
            {note ? <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--xc-text-muted)', fontStyle: 'italic' }}>{note}</div> : null}
        </div>
    );
}

export function VoiceSection() {
    return (
        <Section
            id="voice"
            title="Voice & microcopy"
            tag="GUIDANCE"
            kicker="The wallet's voice is direct, concrete, and unmoralized. Tell the user what's happening and what they can do — never lecture, never hedge, never apologize for the protocol's complexity. These are the conventions we've settled on; reach for them before inventing new copy."
        >
            <Guidance
                what={<>A small set of rules that govern button labels, hints, errors, and confirmation copy across every form. Goal: a user can predict what an action will do from its label alone, and recover from any error from the message alone.</>}
                doRule={<>✓ Active voice, present tense ("Sign this transaction" not "This transaction will be signed") · concrete units always ("0.5 BTC" not "the amount") · echo the user's input back in confirmations · short sentences in error messages, each ending in a period</>}
                dontRule={<>✗ Words that sound formal but say nothing ("Please", "kindly", "in order to") · jargon without translation ("nonce", "UTXO", "PSBT" — name them only when the user is asking about them) · apologetic copy ("Sorry, something went wrong") · vague verbs ("Submit", "Process", "Continue" with no object)</>}
            />

            <LiveExample label="Action verbs — be specific about what happens">
                <Compare
                    good="Send · Receive · Sign · Confirm · Approve · Reject · Copy address"
                    bad="Submit · Process · Continue · Apply · OK"
                    note="The verb names the actual action. 'Submit' could send a payment, save a contact, or unlock a wallet — the user shouldn't have to guess."
                />
                <Compare
                    good="Generate a new address"
                    bad="Click here to make a new address"
                    note="Button labels are imperatives. Drop 'Click here' — the button IS the click."
                />
            </LiveExample>

            <LiveExample label="Asset terminology — coin / tick / token">
                <Compare
                    good={<>"<strong>Bitcoin</strong> · BTC" — chain by long name; tick in uppercase for math display.</>}
                    bad={<>"BITCOIN" everywhere · "asset" as a generic catch-all word in UI</>}
                    note="There is no 'asset' field in the protocol. Use coin (BTC / LTC / DOGE) for the chain family, tick for the per-network token symbol, and 'token' only when referring to non-native tokens specifically."
                />
                <Compare
                    good={<>"Receive on Bitcoin" · "Sending PEPECREATURE on Bitcoin"</>}
                    bad={<>"Choose an asset" · "Pick a chain to deposit to"</>}
                    note="Wallet users think in coins (BTC) and tokens (PEPECREATURE). 'Asset' / 'deposit' are exchange-CEX language — not us."
                />
            </LiveExample>

            <LiveExample label="Error messages — diagnose + recover">
                <Compare
                    good="Insufficient balance. You have 0.001 BTC available."
                    bad="Error: amount exceeds balance"
                    note="Name the constraint, show the actual numbers, and where useful, surface a recovery action (the StatusMessage component takes a `recovery` slot for this — e.g. 'Insufficient balance · Use Max')."
                />
                <Compare
                    good="Incorrect password."
                    bad="Authentication failed (E_AUTH_42)"
                    note="Error codes belong in the console / log, not the UI."
                />
                <Compare
                    good="Could not load the fee estimate. Tap to retry."
                    bad="Sorry, we're having trouble. Please try again later."
                    note="Tell the user exactly what broke and give them the next move."
                />
            </LiveExample>

            <LiveExample label="Confirmation copy — echo + summarize">
                <Compare
                    good={<>"Send <strong>0.5 BTC</strong> to <strong>bc1qxy…7qz3</strong>. Fee <strong>~0.00003 BTC</strong> ($1.85)."</>}
                    bad="Are you sure you want to proceed with this transaction?"
                    note="Confirmations echo what the user typed back. 'Are you sure?' without the details is a guess-prompt — they shouldn't have to remember what they entered to confirm it."
                />
            </LiveExample>

            <LiveExample label="Numbers, fiat, addresses — formatting">
                <Compare
                    good="12,345.67 BTC · $1,234.56 USD · bc1qxy2k…7qz3"
                    bad="12345.67 BTC · 1234.56 USD · bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
                    note="Always thousand-separate digits (4-digit threshold). Fiat to 2 decimals. Long addresses truncate middle-out (8 chars + ellipsis + 4 chars) unless explicitly showing full for verify-paste."
                />
            </LiveExample>
        </Section>
    );
}
