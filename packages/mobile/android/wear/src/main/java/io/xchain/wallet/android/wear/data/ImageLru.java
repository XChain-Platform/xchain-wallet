package io.xchain.wallet.android.wear.data;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class ImageLru {
    public static final int DEFAULT_CAPACITY = 200;

    private final int capacity;
    private final LinkedHashSet<String> hashes = new LinkedHashSet<>();

    public ImageLru() {
        this(DEFAULT_CAPACITY);
    }

    public ImageLru(int capacity) {
        if (capacity < 0) {
            throw new IllegalArgumentException("capacity must not be negative");
        }
        this.capacity = capacity;
    }

    public void touch(String hash) {
        hashes.remove(hash);
        hashes.add(hash);
    }

    public void remove(String hash) {
        hashes.remove(hash);
    }

    public List<String> hashes() {
        return Collections.unmodifiableList(new ArrayList<>(hashes));
    }

    public List<String> evict(Set<String> pinned) {
        List<String> evicted = new ArrayList<>();
        Iterator<String> iterator = hashes.iterator();
        while (hashes.size() > capacity && iterator.hasNext()) {
            String hash = iterator.next();
            if (pinned == null || !pinned.contains(hash)) {
                iterator.remove();
                evicted.add(hash);
            }
        }
        return evicted;
    }
}
