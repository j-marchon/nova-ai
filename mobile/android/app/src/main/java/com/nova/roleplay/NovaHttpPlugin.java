package com.nova.roleplay;

import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/* Streams a request to a service that refuses web pages (no CORS headers),
   which the WebView would otherwise block. Capacitor's own native HTTP hands
   the reply back whole, so a chat reply would arrive in one piece and Stop
   could not cancel it; this one resolves as soon as the status and headers
   are in, then sends the body on as "chunk" events, a few whole lines at a
   time, and ends with "end" or "error". The JS side (send() in lib/api.js)
   turns those into an ordinary streamed Response. */
@CapacitorPlugin(name = "NovaHttp")
public class NovaHttpPlugin extends Plugin {

    private final Map<String, HttpURLConnection> open = new ConcurrentHashMap<>();
    /* cancelled before or while the connection opened */
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    static HttpURLConnection providerConnection(URL endpoint) throws java.io.IOException {
        if (!"https".equals(endpoint.getProtocol()) || endpoint.getUserInfo() != null) {
            throw new IllegalArgumentException("Native providers require HTTPS.");
        }
        HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
        conn.setInstanceFollowRedirects(false);
        return conn;
    }

    @PluginMethod
    public void stream(PluginCall call) {
        final String id = call.getString("id");
        final String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("id and url are required");
            return;
        }
        final String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        final JSObject headers = call.getObject("headers", new JSObject());
        final String body = call.getString("body");
        new Thread(() -> {
            HttpURLConnection conn = null;
            boolean resolved = false;
            try {
                conn = providerConnection(new URL(url));
                open.put(id, conn);
                if (cancelled.contains(id)) throw new Exception("Cancelled");
                conn.setRequestMethod(method);
                conn.setConnectTimeout(30000);
                /* a thinking model can sit quiet for a while between lines */
                conn.setReadTimeout(300000);
                conn.setUseCaches(false);
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    Object v = headers.opt(k);
                    if (v != null) conn.setRequestProperty(k, String.valueOf(v));
                }
                if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    conn.setDoOutput(true);
                    conn.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream out = conn.getOutputStream()) {
                        out.write(bytes);
                    }
                }

                int status = conn.getResponseCode();
                JSObject head = new JSObject();
                JSObject h = new JSObject();
                for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                    if (e.getKey() == null || e.getValue() == null) continue;
                    h.put(e.getKey(), TextUtils.join(", ", e.getValue()));
                }
                head.put("status", status);
                head.put("headers", h);
                call.resolve(head);
                resolved = true;

                InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                if (in != null) {
                    try (InputStream s = in) {
                        pump(id, s);
                    }
                }
                JSObject end = new JSObject();
                end.put("id", id);
                notifyListeners("end", end);
            } catch (Exception e) {
                if (!resolved) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "Network request failed");
                } else if (!cancelled.contains(id)) {
                    JSObject err = new JSObject();
                    err.put("id", id);
                    err.put("message", e.getMessage() != null ? e.getMessage() : "Network request failed");
                    notifyListeners("error", err);
                }
            } finally {
                open.remove(id);
                cancelled.remove(id);
                if (conn != null) conn.disconnect();
            }
        }, "nova-http").start();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            cancelled.add(id);
            HttpURLConnection conn = open.get(id);
            /* the reading thread's next read fails and it winds down */
            if (conn != null) new Thread(conn::disconnect, "nova-http-cancel").start();
        }
        call.resolve();
    }

    /* Sends everything up to the last newline read so far, newline kept, so a
       line is never split. Splitting on the newline byte is safe for UTF-8:
       no multi-byte character contains it. */
    private void pump(String id, InputStream in) throws Exception {
        byte[] buf = new byte[8192];
        ByteArrayOutputStream pending = new ByteArrayOutputStream();
        int n;
        while ((n = in.read(buf)) != -1) {
            int cut = -1;
            for (int i = n - 1; i >= 0; i--) {
                if (buf[i] == '\n') { cut = i; break; }
            }
            if (cut < 0) {
                pending.write(buf, 0, n);
                continue;
            }
            pending.write(buf, 0, cut + 1);
            emit(id, pending.toString("UTF-8"));
            pending.reset();
            pending.write(buf, cut + 1, n - cut - 1);
        }
        if (pending.size() > 0) emit(id, pending.toString("UTF-8"));
    }

    private void emit(String id, String text) {
        if (cancelled.contains(id)) return;
        JSObject chunk = new JSObject();
        chunk.put("id", id);
        chunk.put("text", text);
        notifyListeners("chunk", chunk);
    }
}
