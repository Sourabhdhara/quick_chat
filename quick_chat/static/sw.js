/**
 * QuickChat Service Worker
 * Polls for new messages in the background and shows notifications
 * even when the tab is closed (browser must still be running).
 */

const POLL_INTERVAL = 4000; // 4 seconds
let currentUsername = "";
let lastKnownMessages = {};
let pollTimer = null;
let isPageVisible = true;

// Listen for messages from the main page
self.addEventListener("message", (event) => {
    const data = event.data;

    if (data.type === "init") {
        currentUsername = data.username || "";
        // Seed last known messages so we don't spam on first load
        if (data.conversations) {
            data.conversations.forEach(c => {
                if (c.last_message) {
                    lastKnownMessages[c.id] = {
                        timestamp: c.last_message.timestamp,
                        sender: c.last_message.sender,
                    };
                }
            });
        }
        startPolling();
    }

    if (data.type === "visibility") {
        isPageVisible = data.visible;
    }

    if (data.type === "update-conversations") {
        // Page is handling its own notifications, just sync state
        if (data.conversations) {
            data.conversations.forEach(c => {
                if (c.last_message) {
                    lastKnownMessages[c.id] = {
                        timestamp: c.last_message.timestamp,
                        sender: c.last_message.sender,
                    };
                }
            });
        }
    }
});

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        // Only poll and notify when the page is NOT visible/focused
        // (When the page is visible, the main JS handles notifications with toasts + sound)
        if (!isPageVisible) {
            checkForNewMessages();
        }
    }, POLL_INTERVAL);
}

async function checkForNewMessages() {
    try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;
        const convos = await res.json();

        convos.forEach(c => {
            if (!c.last_message) return;
            const key = c.id;
            const ts = c.last_message.timestamp;
            const sender = c.last_message.sender;
            const msgType = c.last_message.type || "text";

            const prev = lastKnownMessages[key];
            if (!prev) {
                lastKnownMessages[key] = { timestamp: ts, sender };
                return;
            }

            if (ts !== prev.timestamp && sender !== currentUsername) {
                lastKnownMessages[key] = { timestamp: ts, sender };

                // Skip call-type messages
                if (msgType === "call") return;

                // Show notification via Service Worker API
                showBgNotification(sender, c.last_message.text, c);
            } else {
                lastKnownMessages[key] = { timestamp: ts, sender };
            }
        });
    } catch (err) {
        // Silently fail — network issues, logged out, etc.
    }
}

function showBgNotification(sender, text, convo) {
    const body = text && text.length > 100 ? text.substring(0, 100) + "…" : (text || "New message");

    self.registration.showNotification(sender, {
        body: body,
        icon: convo && convo.profile_pic ? convo.profile_pic : undefined,
        badge: convo && convo.profile_pic ? convo.profile_pic : undefined,
        tag: `msg-${convo ? convo.id : "unknown"}`,
        data: { conversationId: convo ? convo.id : null, url: "/chat" },
        vibrate: [100, 50, 100],
        requireInteraction: false,
    }).catch(() => {});
}

// Handle notification click — focus or open the app
self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/chat";
    const convoId = event.notification.data ? event.notification.data.conversationId : null;

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            // If a tab is already open, focus it
            for (const client of clientList) {
                if (client.url.includes("/chat") && "focus" in client) {
                    client.focus();
                    if (convoId) {
                        client.postMessage({ type: "open-conversation", conversationId: convoId });
                    }
                    return;
                }
            }
            // Otherwise open a new tab
            return clients.openWindow(url);
        })
    );
});

// Keep the service worker alive
self.addEventListener("install", (event) => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(clients.claim());
});
