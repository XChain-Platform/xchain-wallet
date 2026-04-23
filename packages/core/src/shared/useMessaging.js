import { useContext } from 'react';
import { MessagingContext } from './MessagingContext.js';

/**
 * Access the shell's messaging module + shell identifier.
 *
 * Throws when used outside `<MessagingProvider>` — surfaces routing
 * mistakes immediately rather than silently returning null and letting
 * a downstream call fail with "cannot read properties of null".
 *
 * @returns {import('./MessagingContext.js').MessagingContextValue}
 */
export function useMessaging() {
    const value = useContext(MessagingContext);
    if (!value) {
        throw new Error('useMessaging must be used inside <MessagingProvider>.');
    }
    return value;
}

/**
 * Resolve the Screen layout variant from the current shell.
 *
 * @param {'popup' | 'web' | 'desktop'} shell
 * @returns {'popup' | 'full'}
 */
export function screenVariantFor(shell) {
    return shell === 'popup' ? 'popup' : 'full';
}
