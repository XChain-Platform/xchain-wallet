package io.xchain.wallet.android.wear.sync;

import io.xchain.wallet.android.wear.data.WatchPaths;

import java.util.Collections;
import java.util.EnumSet;
import java.util.Set;

public final class ListenerActions {
    private ListenerActions() {
    }

    public enum Action {
        STORE_SNAPSHOT,
        WIPE,
        STORE_DETAIL,
        STORE_IMAGE,
        REFRESH_GLANCES
    }

    public static Set<Action> forEvent(WatchPaths.Incoming incoming, Boolean stateEnabled,
            long stateBuiltAt, Long storedBuiltAt) {
        if (incoming == null) {
            return Collections.emptySet();
        }

        switch (incoming.kind) {
            case SNAPSHOT:
                return immutableActions(Action.STORE_SNAPSHOT, Action.REFRESH_GLANCES);
            case STATE:
                if (Boolean.FALSE.equals(stateEnabled)
                        && (storedBuiltAt == null || stateBuiltAt >= storedBuiltAt)) {
                    return immutableActions(Action.WIPE, Action.REFRESH_GLANCES);
                }
                return Collections.emptySet();
            case DETAIL:
                return immutableActions(Action.STORE_DETAIL);
            case IMAGE:
                return immutableActions(Action.STORE_IMAGE);
            default:
                return Collections.emptySet();
        }
    }

    private static Set<Action> immutableActions(Action first, Action... remaining) {
        EnumSet<Action> actions = EnumSet.of(first, remaining);
        return Collections.unmodifiableSet(actions);
    }
}
