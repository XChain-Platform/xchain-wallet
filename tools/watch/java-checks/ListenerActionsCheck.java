import io.xchain.wallet.android.wear.data.WatchPaths;
import io.xchain.wallet.android.wear.sync.ListenerActions;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class ListenerActionsCheck {
    private static final String HASH =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private ListenerActionsCheck() {
    }

    public static void main(String[] args) {
        WatchPaths.Incoming snapshot = WatchPaths.classify("/xc/snapshot");
        WatchPaths.Incoming state = WatchPaths.classify("/xc/state");
        WatchPaths.Incoming detail = WatchPaths.classify("/xc/detail/a");
        WatchPaths.Incoming image = WatchPaths.classify("/xc/image/" + HASH);

        checkActions("snapshot without stored snapshot",
                ListenerActions.forEvent(snapshot, Boolean.FALSE, 100L, null),
                ListenerActions.Action.STORE_SNAPSHOT,
                ListenerActions.Action.REFRESH_GLANCES);
        checkActions("snapshot with stored snapshot",
                ListenerActions.forEvent(snapshot, Boolean.FALSE, 100L, 200L),
                ListenerActions.Action.STORE_SNAPSHOT,
                ListenerActions.Action.REFRESH_GLANCES);

        checkActions("disabled state with nothing stored",
                ListenerActions.forEvent(state, Boolean.FALSE, 100L, null),
                ListenerActions.Action.WIPE,
                ListenerActions.Action.REFRESH_GLANCES);
        checkActions("disabled state newer than stored snapshot",
                ListenerActions.forEvent(state, Boolean.FALSE, 100L, 99L),
                ListenerActions.Action.WIPE,
                ListenerActions.Action.REFRESH_GLANCES);
        checkActions("disabled state same age as stored snapshot",
                ListenerActions.forEvent(state, Boolean.FALSE, 100L, 100L),
                ListenerActions.Action.WIPE,
                ListenerActions.Action.REFRESH_GLANCES);
        checkActions("disabled state older than stored snapshot",
                ListenerActions.forEvent(state, Boolean.FALSE, 100L, 101L));
        checkActions("enabled state",
                ListenerActions.forEvent(state, Boolean.TRUE, 100L, null));
        checkActions("state with unknown enabled value",
                ListenerActions.forEvent(state, null, 100L, null));

        checkActions("detail",
                ListenerActions.forEvent(detail, null, 0L, null),
                ListenerActions.Action.STORE_DETAIL);
        checkActions("image",
                ListenerActions.forEvent(image, null, 0L, null),
                ListenerActions.Action.STORE_IMAGE);
        checkActions("null event",
                ListenerActions.forEvent(null, Boolean.FALSE, 100L, null));

        checkUnmodifiable(snapshot);
    }

    private static void checkActions(String name, Set<ListenerActions.Action> actual,
            ListenerActions.Action... expected) {
        Set<ListenerActions.Action> expectedSet = new HashSet<>(Arrays.asList(expected));
        check(name, actual.equals(expectedSet));
    }

    private static void checkUnmodifiable(WatchPaths.Incoming snapshot) {
        Set<ListenerActions.Action> actions =
                ListenerActions.forEvent(snapshot, null, 0L, null);
        try {
            actions.add(ListenerActions.Action.WIPE);
            fail("returned set refuses add");
        } catch (UnsupportedOperationException expected) {
            check("returned set unchanged after refused add",
                    !actions.contains(ListenerActions.Action.WIPE));
        }
    }

    private static void check(String name, boolean condition) {
        if (!condition) {
            fail(name);
        }
    }

    private static void fail(String name) {
        System.err.println("FAILED: " + name);
        System.exit(1);
    }
}
