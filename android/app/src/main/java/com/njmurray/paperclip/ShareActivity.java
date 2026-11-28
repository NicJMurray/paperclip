package com.njmurray.paperclip;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.widget.Toast;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.json.JSONObject;

public class ShareActivity extends Activity {
    private static final long MAX_FILE = 10L * 1024 * 1024;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            finish();
            return;
        }
        Intent intent = getIntent();
        new Thread(() -> capture(intent), "paperclip-copy").start();
    }

    private void capture(Intent intent) {
        int saved = 0;
        String problem = null;
        try {
            SharedContent share = readShare(intent);
            if (share.files.isEmpty()) {
                save(share.text, share.title, null);
                saved++;
            }
            for (Uri uri : share.files) {
                try {
                    save(share.text, share.title, uri);
                    saved++;
                } catch (Exception error) {
                    if (problem == null) problem = copyError(error);
                }
            }
        } catch (Exception error) {
            problem = copyError(error);
        }
        int count = saved;
        String message = problem;
        runOnUiThread(() -> {
            if (count > 0) Toast.makeText(this, count == 1 ? "Queued in Paperclip" : "Queued " + count + " items", Toast.LENGTH_SHORT).show();
            if (message != null) Toast.makeText(this, (count > 0 ? "Some items were saved. " : "") + message, Toast.LENGTH_LONG).show();
            if (count > 0 && Settings.token(this) == null) startActivity(new Intent(this, MainActivity.class));
            finish();
        });
    }

    static final class SharedContent {
        final String text;
        final String title;
        final Set<Uri> files;

        SharedContent(String text, String title, Set<Uri> files) {
            this.text = text;
            this.title = title;
            this.files = files;
        }
    }

    @SuppressWarnings("deprecation")
    static SharedContent readShare(Intent intent) throws IOException {
        String action = intent.getAction();
        boolean multiple = Intent.ACTION_SEND_MULTIPLE.equals(action);
        boolean selection = Intent.ACTION_PROCESS_TEXT.equals(action);
        if (!multiple && !selection && !Intent.ACTION_SEND.equals(action)) throw new IOException("Share a link, text or file to Paperclip.");

        Set<String> text = new LinkedHashSet<>();
        Set<Uri> files = new LinkedHashSet<>();
        ArrayList<CharSequence> captions = multiple ? intent.getCharSequenceArrayListExtra(Intent.EXTRA_TEXT) : null;
        if (captions == null) addText(text, intent.getCharSequenceExtra(selection ? Intent.EXTRA_PROCESS_TEXT : Intent.EXTRA_TEXT));
        else for (CharSequence caption : captions) addText(text, caption);

        if (multiple) {
            ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null) for (Uri uri : streams) addUri(files, text, uri);
        } else addUri(files, text, intent.getParcelableExtra(Intent.EXTRA_STREAM));

        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int index = 0; index < clip.getItemCount(); index++) {
                ClipData.Item item = clip.getItemAt(index);
                addText(text, item.getText());
                addUri(files, text, item.getUri());
            }
        }
        addUri(files, text, intent.getData());
        String caption = String.join("\n", text);
        if (files.size() > 30) throw new IOException("Share up to 30 files at a time.");
        if (caption.length() > 32000) throw new IOException("This text is too long to save (32,000 characters maximum).");
        if (files.isEmpty() && caption.isEmpty()) throw new IOException("There is no link, text or file to save.");

        CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        if (subject == null) subject = intent.getCharSequenceExtra(Intent.EXTRA_TITLE);
        String title = subject == null ? "" : subject.subSequence(0, Math.min(subject.length(), 500)).toString();
        return new SharedContent(caption, title, files);
    }

    private static void addText(Set<String> values, CharSequence value) {
        if (value != null && !value.toString().trim().isEmpty()) values.add(value.toString());
    }

    private static void addUri(Set<Uri> files, Set<String> text, Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
            String link = uri.toString();
            if (text.stream().noneMatch(value -> value.contains(link))) text.add(link);
        } else files.add(uri);
    }

    private static String copyError(Exception error) {
        return error instanceof IOException && error.getMessage() != null
            ? error.getMessage() : "Could not copy this share. Please try sharing it again.";
    }

    private void save(String text, String title, Uri uri) throws Exception {
        String id = UUID.randomUUID().toString();
        File staging = new File(Queue.root(this), "." + id);
        if (!staging.mkdir()) throw new IOException("Not enough space on this phone.");
        try {
            JSONObject meta = new JSONObject().put("id", id).put("text", text).put("title", title).put("created_at", System.currentTimeMillis());
            if (uri != null) {
                // A content URI grants access to this item without filesystem permissions.
                if (!"content".equals(uri.getScheme())) throw new IOException("This app did not provide a readable file.");
                meta.put("file_name", fileName(uri));
                copyFile(uri, new File(staging, "attachment"));
            }
            Queue.write(new File(staging, "meta.json"), meta.toString());
            File queued = new File(Queue.root(this), id);
            if (!staging.renameTo(queued)) throw new IOException("Could not store this share on the phone.");
            Queue.schedule(getApplicationContext(), id, false);
        } finally {
            if (staging.exists()) Queue.remove(staging);
        }
    }

    private void copyFile(Uri uri, File file) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(file)) {
            if (in == null) throw new IOException("Could not read this file.");
            byte[] buffer = new byte[32768];
            long size = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                size += read;
                if (size > MAX_FILE) throw new IOException("This file is over 10 MB. Share a smaller copy.");
                out.write(buffer, 0, read);
            }
            if (size == 0) throw new IOException("This file is empty.");
            out.getFD().sync();
        }
    }

    private String fileName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.trim().isEmpty()) return name.substring(0, Math.min(name.length(), 255));
            }
        } catch (RuntimeException ignored) { /* A provider may supply a stream without its display name. */ }
        try {
            String type = getContentResolver().getType(uri);
            String extension = type == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(type);
            if (extension != null) return "Attachment." + extension;
        } catch (RuntimeException ignored) { /* The bytes may still be readable without a MIME type. */ }
        return "Attachment";
    }
}
