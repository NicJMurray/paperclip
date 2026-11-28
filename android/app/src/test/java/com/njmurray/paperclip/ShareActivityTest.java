package com.njmurray.paperclip;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class ShareActivityTest {
    @Test public void keepsOriginalLinkAndTitle() throws Exception {
        Intent share = new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "Read https://example.org/file")
            .putExtra(Intent.EXTRA_SUBJECT, "Original title");
        ShareActivity.SharedContent content = ShareActivity.readShare(share);
        assertEquals("Read https://example.org/file", content.text);
        assertEquals("Original title", content.title);
        assertTrue(content.files.isEmpty());
    }

    @Test public void readsDocumentAndImageFromMixedShareWithoutDuplicatingStreams() throws Exception {
        Uri document = Uri.parse("content://example/guide.pdf");
        Uri image = Uri.parse("content://example/photo.png");
        ClipData clip = ClipData.newRawUri("Document", document);
        clip.addItem(new ClipData.Item(image));
        Intent share = new Intent(Intent.ACTION_SEND_MULTIPLE).setType("*/*")
            .putParcelableArrayListExtra(Intent.EXTRA_STREAM, new ArrayList<>(List.of(document)))
            .putCharSequenceArrayListExtra(Intent.EXTRA_TEXT, new ArrayList<>(List.of("A document and a photo")));
        share.setClipData(clip);

        ShareActivity.SharedContent content = ShareActivity.readShare(share);
        assertEquals("A document and a photo", content.text);
        assertEquals(List.of(document, image), new ArrayList<>(content.files));
    }
}
