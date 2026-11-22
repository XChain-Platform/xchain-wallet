package io.xchain.wallet.android.wear

import io.xchain.wallet.android.wear.data.ImageCache
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class ImageCacheTest {
    private lateinit var directory: File

    @Before
    fun setUp() {
        directory = Files.createTempDirectory("image-cache-").toFile()
    }

    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    @Test
    fun receivesAnImageChannelIntoAHashNamedFile() {
        val cache = ImageCache(directory)
        val bytes = "image".toByteArray()
        val contentHash = hash(42)

        assertTrue(cache.receive(imagePath(contentHash), bytes))

        assertArrayEquals(bytes, cache.data(contentHash))
        assertEquals(listOf(contentHash), fileNames())
    }

    @Test
    fun rejectsNonImageAndMalformedChannelPaths() {
        val cache = ImageCache(directory)
        val bytes = "image".toByteArray()

        assertFalse(cache.receive("/xc/detail/${hash(1)}", bytes))
        assertFalse(cache.receive("/xc/image/${hash(10).uppercase()}", bytes))
        assertFalse(cache.receive("/xc/image/${hash(3).dropLast(1)}", bytes))

        assertTrue(fileNames().isEmpty())
    }

    @Test
    fun evictsTheLeastRecentlyUsedFileAtExactlyTwoHundred() {
        val cache = ImageCache(directory)
        store(201, cache)

        assertNull(cache.data(hash(0)))
        assertTrue(directory.resolve(hash(1)).isFile)
        assertEquals(ImageCache.CAPACITY, fileNames().size)
    }

    @Test
    fun readingAFileMakesItMostRecentlyUsed() {
        val cache = ImageCache(directory)
        store(ImageCache.CAPACITY, cache)
        assertTrue(cache.data(hash(0)) != null)

        cache.receive(imagePath(hash(ImageCache.CAPACITY)), byteArrayOf(255.toByte()))

        assertTrue(directory.resolve(hash(0)).isFile)
        assertFalse(directory.resolve(hash(1)).exists())
    }

    @Test
    fun snapshotAndOpenDetailHashesAreNeverEvicted() {
        val cache = ImageCache(directory)
        val snapshotHash = hash(500)
        val detailHash = hash(501)
        cache.receive(imagePath(snapshotHash), byteArrayOf(1))
        cache.receive(imagePath(detailHash), byteArrayOf(2))
        cache.setPinned(setOf(snapshotHash), setOf(detailHash))
        store(199, cache)

        assertTrue(directory.resolve(snapshotHash).isFile)
        assertTrue(directory.resolve(detailHash).isFile)
        assertFalse(directory.resolve(hash(0)).exists())
        assertEquals(ImageCache.CAPACITY, fileNames().size)
    }

    @Test
    fun doesNotEvictWhenEveryOverflowFileIsPinned() {
        val cache = ImageCache(directory)
        val hashes = (0..ImageCache.CAPACITY).map(::hash).toSet()
        cache.setPinned(hashes, emptySet())
        store(ImageCache.CAPACITY + 1, cache)

        assertEquals(ImageCache.CAPACITY + 1, fileNames().size)
    }

    @Test
    fun restoredPinnedFileSurvivesUntilPinsAreSupplied() {
        repeat(ImageCache.CAPACITY + 1) { index ->
            directory.resolve(hash(index)).apply {
                writeBytes(byteArrayOf((index % 256).toByte()))
                setLastModified(index + 1L)
            }
        }

        val cache = ImageCache(directory)
        cache.setPinned(setOf(hash(0)), emptySet())

        assertTrue(directory.resolve(hash(0)).isFile)
        assertFalse(directory.resolve(hash(1)).exists())
        assertEquals(ImageCache.CAPACITY, fileNames().size)
    }

    private fun store(count: Int, cache: ImageCache) {
        repeat(count) { index ->
            cache.receive(imagePath(hash(index)), byteArrayOf((index % 256).toByte()))
        }
    }

    private fun hash(index: Int) = "%064x".format(index)

    private fun imagePath(hash: String) = "/xc/image/$hash"

    private fun fileNames() = directory.list()?.sorted().orEmpty()
}
