package io.xchain.wallet.android.wear.data

import java.io.File

class ImageCache(private val directory: File) {
    companion object {
        const val CAPACITY = 200
    }

    private val lru = ImageLru(CAPACITY)
    private var pinned = emptySet<String>()

    init {
        directory.listFiles()
            ?.filter { it.isFile }
            ?.sortedBy { it.lastModified() }
            ?.forEach { lru.touch(it.name) }
    }

    @Synchronized
    fun setPinned(snapshot: Set<String>, openDetail: Set<String>) {
        pinned = snapshot + openDetail
        evict()
    }

    @Synchronized
    fun receive(path: String, data: ByteArray): Boolean {
        val incoming = WatchPaths.classify(path)
        if (incoming?.kind != WatchPaths.Kind.IMAGE) return false

        val hash = checkNotNull(incoming.key)
        check(directory.exists() || directory.mkdirs()) { "Could not create image cache directory" }
        file(hash).writeBytes(data)
        lru.touch(hash)
        evict()
        return true
    }

    @Synchronized
    fun data(hash: String): ByteArray? {
        val file = file(hash)
        val data = runCatching { file.readBytes() }.getOrNull()
        if (data == null) {
            lru.remove(hash)
            return null
        }
        lru.touch(hash)
        file.setLastModified(System.currentTimeMillis())
        return data
    }

    private fun file(hash: String) = File(directory, hash)

    private fun evict() {
        lru.evict(pinned).forEach { file(it).delete() }
    }
}
