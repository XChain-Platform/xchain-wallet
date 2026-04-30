import { useMemo } from 'react';
import { MessagingContext } from './MessagingContext.js';
import { PrivacyBlurGate } from './PrivacyBlurGate.jsx';
import { LocaleSync } from './LocaleSync.jsx';

/**
 * Wraps the app shell so every shared route can reach the correct
 * messaging module + know which shell it's rendering in.
 *
 * Hosts the §26 / G069 PrivacyBlurGate as a sibling to children so the
 * hook re-runs whenever settings change, without forcing every shell
 * to mount the gate manually.
 *
 * Cluster R FOLLOWUP 4 — also mounts <LocaleSync /> so a saved
 * `settings.language` rehydrates the live i18n locale on cold start.
 *
 * @param {object} props
 * @param {'popup' | 'web' | 'desktop'} props.shell
 * @param {import('./MessagingContext.js').MessagingModule} props.messaging
 * @param {import('react').ReactNode} props.children
 */
export function MessagingProvider({ shell, messaging, children }) {
    const value = useMemo(() => ({ shell, messaging }), [shell, messaging]);
    return (
        <MessagingContext.Provider value={value}>
            <PrivacyBlurGate />
            <LocaleSync />
            {children}
        </MessagingContext.Provider>
    );
}
