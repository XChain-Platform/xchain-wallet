import { useMemo } from 'react';
import { MessagingContext } from './MessagingContext.js';

/**
 * Wraps the app shell so every shared route can reach the correct
 * messaging module + know which shell it's rendering in.
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
            {children}
        </MessagingContext.Provider>
    );
}
