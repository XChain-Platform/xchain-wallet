import io.xchain.wallet.android.wear.data.ImageLru;

import java.util.Arrays;
import java.util.Collections;
import java.util.Set;

public final class ImageLruCheck {
    public static void main(String[] args) {
        defaultCapacityEvictsFirst();
        retouchedOldestSurvives();
        pinnedOldestIsSkipped();
        pinnedHashesCanExceedCapacity();
        removeThenTouchMovesLast();
        nullPinnedSetPinsNothing();
        hashesAreUnmodifiable();
    }

    private static void defaultCapacityEvictsFirst() {
        ImageLru lru = new ImageLru();
        for (int index = 0; index <= 200; index++) {
            lru.touch("hash-" + index);
        }

        check(ImageLru.DEFAULT_CAPACITY == 200, "default capacity is 200");
        check(
                lru.evict(Collections.emptySet()).equals(Collections.singletonList("hash-0")),
                "default capacity evicts exactly the first hash");
        check(
                lru.hashes().size() == 200,
                "default capacity leaves 200 hashes");
    }

    private static void retouchedOldestSurvives() {
        ImageLru lru = new ImageLru(2);
        lru.touch("first");
        lru.touch("second");
        lru.touch("first");
        lru.touch("third");

        check(
                lru.evict(Collections.emptySet()).equals(Collections.singletonList("second")),
                "re-touched oldest survives and next oldest is evicted");
        check(
                lru.hashes().equals(Arrays.asList("first", "third")),
                "re-touched hash remains in recency order");
    }

    private static void pinnedOldestIsSkipped() {
        ImageLru lru = new ImageLru(2);
        lru.touch("first");
        lru.touch("second");
        lru.touch("third");

        check(
                lru.evict(Collections.singleton("first")).equals(Collections.singletonList("second")),
                "pinned least-recent hash is skipped");
        check(
                lru.hashes().equals(Arrays.asList("first", "third")),
                "pinned least-recent hash remains cached");
    }

    private static void pinnedHashesCanExceedCapacity() {
        ImageLru lru = new ImageLru(2);
        lru.touch("first");
        lru.touch("second");
        lru.touch("third");

        check(
                lru.evict(Set.of("first", "second", "third")).isEmpty(),
                "three pinned hashes at capacity two evict nothing");
        check(
                lru.hashes().size() == 3,
                "pinned hashes may keep the cache above capacity");
    }

    private static void removeThenTouchMovesLast() {
        ImageLru lru = new ImageLru(3);
        lru.touch("first");
        lru.touch("second");
        lru.touch("third");
        lru.remove("second");
        lru.touch("second");

        check(
                lru.hashes().equals(Arrays.asList("first", "third", "second")),
                "remove then touch puts hash last");
    }

    private static void nullPinnedSetPinsNothing() {
        ImageLru lru = new ImageLru(2);
        lru.touch("first");
        lru.touch("second");
        lru.touch("third");

        check(
                lru.evict(null).equals(Collections.singletonList("first")),
                "null pinned set evicts as an empty set");
    }

    private static void hashesAreUnmodifiable() {
        ImageLru lru = new ImageLru();
        lru.touch("first");

        try {
            lru.hashes().add("second");
            check(false, "hash list is unmodifiable");
        } catch (UnsupportedOperationException expected) {
            check(lru.hashes().equals(Collections.singletonList("first")),
                    "hash list is unmodifiable");
        }
    }

    private static void check(boolean condition, String name) {
        if (!condition) {
            System.err.println("FAIL: " + name);
            System.exit(1);
        }
    }
}
