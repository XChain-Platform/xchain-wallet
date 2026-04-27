// PrivacyBlurGate — §26 / G069 mount point. Renders nothing; bridges
// `settings.privacy.blurOnBlur` into `usePrivacyBlur` so every shell that
// wraps its tree in <MessagingProvider> automatically gets the privacy
// blur behaviour without duplicating the wiring.
//
// While the wallet is locked or settings are still loading the hook
// receives `false` and is fully inert. Once the user unlocks and
// settings are read, the live preference takes over.

import { useSettings } from './hooks/useSettings.js';
import { usePrivacyBlur } from './hooks/usePrivacyBlur.js';

export function PrivacyBlurGate() {
    const { settings } = useSettings();
    const enabled = Boolean(settings?.privacy?.blurOnBlur);
    usePrivacyBlur(enabled);
    return null;
}
