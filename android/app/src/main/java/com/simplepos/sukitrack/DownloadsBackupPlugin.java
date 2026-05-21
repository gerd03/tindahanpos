package com.simplepos.sukitrack;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DownloadsBackup")
public class DownloadsBackupPlugin extends Plugin {
    @PluginMethod
    public void writeBackup(PluginCall call) {
        String filename = call.getString("filename");
        String folder = call.getString("folder", "SUKI TRACK Backups");
        String data = call.getString("data");

        if (filename == null || filename.trim().isEmpty() || data == null) {
            call.reject("Missing backup filename or data.");
            return;
        }

        try {
            JSObject result = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? writeWithMediaStore(filename, folder, data)
                : writeLegacy(filename, folder, data);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    private JSObject writeWithMediaStore(String filename, String folder, String data) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
        values.put(
            MediaStore.Downloads.RELATIVE_PATH,
            Environment.DIRECTORY_DOWNLOADS + File.separator + folder
        );
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) {
            throw new IllegalStateException("Unable to create backup in Downloads.");
        }

        try (OutputStream output = resolver.openOutputStream(uri, "w")) {
            if (output == null) {
                throw new IllegalStateException("Unable to open backup file.");
            }
            output.write(data.getBytes(StandardCharsets.UTF_8));
        }

        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, values, null, null);

        return buildResult(filename, "Download/" + folder + "/" + filename, uri.toString());
    }

    private JSObject writeLegacy(String filename, String folder, String data) throws Exception {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File backupDir = new File(downloads, folder);
        if (!backupDir.exists() && !backupDir.mkdirs()) {
            throw new IllegalStateException("Unable to create Downloads backup folder.");
        }

        File file = new File(backupDir, filename);
        try (FileOutputStream output = new FileOutputStream(file, false)) {
            output.write(data.getBytes(StandardCharsets.UTF_8));
        }

        return buildResult(filename, file.getAbsolutePath(), Uri.fromFile(file).toString());
    }

    private JSObject buildResult(String filename, String path, String uri) {
        JSObject result = new JSObject();
        result.put("filename", filename);
        result.put("path", path);
        result.put("uri", uri);
        return result;
    }
}
