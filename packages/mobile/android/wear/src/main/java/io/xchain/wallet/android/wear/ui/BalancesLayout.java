package io.xchain.wallet.android.wear.ui;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

public final class BalancesLayout {
    public static final int ROW_LIMIT = 50;

    private BalancesLayout() {}

    public enum Kind {
        REQUEST,
        ROW,
        MORE_ON_PHONE,
        EMPTY
    }

    public static final class Item {
        public final Kind kind;
        public final int index;

        public Item(Kind kind, int index) {
            this.kind = Objects.requireNonNull(kind, "kind");
            this.index = index;
        }

        public Kind getKind() {
            return kind;
        }

        public int getIndex() {
            return index;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof Item)) {
                return false;
            }
            Item that = (Item) other;
            return index == that.index && kind == that.kind;
        }

        @Override
        public int hashCode() {
            return Objects.hash(kind, index);
        }

        @Override
        public String toString() {
            return "Item{" + "kind=" + kind + ", index=" + index + '}';
        }
    }

    public static List<Item> items(int rowCount, boolean hasRequest, boolean capped) {
        List<Item> items = new ArrayList<>();
        if (hasRequest) {
            items.add(new Item(Kind.REQUEST, -1));
        }

        int listedRows = Math.min(Math.max(rowCount, 0), ROW_LIMIT);
        if (listedRows == 0) {
            items.add(new Item(Kind.EMPTY, -1));
        } else {
            for (int index = 0; index < listedRows; index++) {
                items.add(new Item(Kind.ROW, index));
            }
            if (capped) {
                items.add(new Item(Kind.MORE_ON_PHONE, -1));
            }
        }

        return Collections.unmodifiableList(items);
    }

    public static String textKey(Item item) {
        switch (Objects.requireNonNull(item, "item").kind) {
            case REQUEST:
                return "w1.requestWaiting";
            case MORE_ON_PHONE:
                return "state.moreOnPhone";
            case EMPTY:
                return "w1.empty";
            case ROW:
                return null;
            default:
                throw new AssertionError(item.kind);
        }
    }

    public static String headerKey(boolean fiatMode) {
        return fiatMode ? null : "w1.title";
    }
}
