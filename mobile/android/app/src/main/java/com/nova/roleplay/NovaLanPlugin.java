package com.nova.roleplay;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/* Finds Nova Bridge on the Wi-Fi, so nobody has to type the computer's
   address. A web page cannot send UDP, so this small native piece does:
   it broadcasts NOVA_BRIDGE_DISCOVER to the bridge's port and collects who
   answers. It also reports this phone's own addresses, which the app uses
   to sweep the right network when broadcasts are blocked. */
@CapacitorPlugin(name = "NovaLan")
public class NovaLanPlugin extends Plugin {

    @PluginMethod
    public void discover(PluginCall call) {
        final int port = call.getInt("port", 5005);
        final int wait = Math.max(300, Math.min(call.getInt("timeout", 1500), 5000));
        new Thread(() -> {
            JSObject result = new JSObject();
            JSArray found = new JSArray();
            JSArray addresses = new JSArray();
            List<InetAddress> targets = new ArrayList<>();
            try {
                for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                        if (!(ia.getAddress() instanceof Inet4Address)) continue;
                        JSObject a = new JSObject();
                        a.put("address", ia.getAddress().getHostAddress());
                        a.put("prefix", ia.getNetworkPrefixLength());
                        addresses.put(a);
                        if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
                    }
                }
            } catch (Exception ignored) {}

            DatagramSocket socket = null;
            try {
                socket = new DatagramSocket();
                socket.setBroadcast(true);
                socket.setSoTimeout(150);
                targets.add(InetAddress.getByName("255.255.255.255"));
                byte[] ask = "NOVA_BRIDGE_DISCOVER".getBytes(StandardCharsets.UTF_8);
                Set<String> seen = new LinkedHashSet<>();
                long start = System.currentTimeMillis();
                long deadline = start + wait;
                boolean resent = false;
                send(socket, ask, targets, port);
                byte[] buf = new byte[2048];
                while (System.currentTimeMillis() < deadline) {
                    /* a second shout halfway, for the packet Wi-Fi drops */
                    if (!resent && System.currentTimeMillis() - start > wait / 2) {
                        send(socket, ask, targets, port);
                        resent = true;
                    }
                    DatagramPacket reply = new DatagramPacket(buf, buf.length);
                    try {
                        socket.receive(reply);
                    } catch (SocketTimeoutException e) {
                        continue;
                    }
                    String host = reply.getAddress().getHostAddress();
                    if (!seen.add(host)) continue;
                    JSObject hit = new JSObject();
                    hit.put("host", host);
                    try {
                        JSObject body = new JSObject(new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8));
                        hit.put("port", body.optInt("port", port));
                        hit.put("name", body.optString("name", ""));
                    } catch (Exception e) {
                        hit.put("port", port);
                    }
                    found.put(hit);
                }
            } catch (Exception ignored) {
            } finally {
                if (socket != null) socket.close();
            }
            result.put("found", found);
            result.put("addresses", addresses);
            call.resolve(result);
        }, "nova-lan").start();
    }

    private static void send(DatagramSocket socket, byte[] data, List<InetAddress> targets, int port) {
        for (InetAddress t : targets) {
            try {
                socket.send(new DatagramPacket(data, data.length, t, port));
            } catch (Exception ignored) {}
        }
    }
}
