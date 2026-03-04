document.getElementById('useCurrentLocationBtn').onclick = function() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(function(pos) {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (marker) marker.setLatLng([lat, lng]);
            if (map) map.setView([lat, lng], 15);
        }, function(err) {
            alert('Unable to fetch current location.');
        });
    } else {
        alert('Geolocation is not supported by your browser.');
    }
};

function sendLocation(lat, lng) {
    if (!window.currentConversationId) {
        alert('No conversation selected.');
        return;
    }
    fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversation_id: window.currentConversationId,
            type: 'location',
            text: 'Shared a location',
            latitude: lat,
            longitude: lng
        })
    }).then(res => {
        if (res.ok) {
            if (typeof loadMessages === 'function') loadMessages(window.currentConversationId);
            if (typeof loadConversations === 'function') loadConversations();
        } else {
            alert('Failed to send location.');
        }
    }).catch(() => alert('Failed to send location.'));
}
let map, marker;
function openLocationPicker(defaultLat = 28.6139, defaultLng = 77.2090) {
    document.getElementById('locationPickerModal').style.display = 'block';
    setTimeout(() => {
        map = L.map('map').setView([defaultLat, defaultLng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        marker = L.marker([defaultLat, defaultLng], {draggable:true}).addTo(map);
        map.on('click', function(e) {
            marker.setLatLng(e.latlng);
        });
    }, 100);
    document.getElementById('sendLocationBtn').onclick = function() {
        const {lat, lng} = marker.getLatLng();
        sendLocation(lat, lng); // Replace with your location sending logic
        closeLocationPicker();
    };
}
function closeLocationPicker() {
    document.getElementById('locationPickerModal').style.display = 'none';
    if (map) { map.remove(); map = null; }
}
function showLocationPreview(lat, lng) {
  document.getElementById('locationPreviewModal').style.display = 'block';
  setTimeout(() => {
    const map = L.map('locationPreviewMap', {zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false}).setView([lat, lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker([lat, lng]).addTo(map);
  }, 100);
}
function closeLocationPreview() {
  document.getElementById('locationPreviewModal').style.display = 'none';
  if (window.locationPreviewMapInstance) {
    window.locationPreviewMapInstance.remove();
    window.locationPreviewMapInstance = null;
  }
}
/**
 * QuickChat — Frontend Logic
 * Handles conversations, text/file/voice/location messaging.
 */

// ==================
//  State
// ==================
let currentConversationId = null;
let conversations = [];
let pollTimers = {};
let selectedUsers = [];
let mediaRecorder = null;
let audioChunks = [];
let recInterval = null;
let recStart = 0;
let isEditingMessage = false;  // Prevents polling from overwriting inline edit
let lastMessageCount = 0;
let lastMessageTimestamp = "";

// Message action state
let selectedMessages = new Set();  // Set of message IDs
let isSelectMode = false;
let contextMenuMsg = null;  // message data for active context menu

// Notification state
let lastKnownMessages = {};   // convoId -> { timestamp, sender }
let notificationsReady = false;

// Call state
let peerConnection = null;
let localStream = null;
let currentCallId = null;
let callTimerInterval = null;
let callStartTime = 0;
let isMuted = false;
let isCameraOff = false;
let icePollInterval = null;

// Typing indicator state
let typingTimeout = null;
let typingPollInterval = null;
let currentlyTyping = [];  // array of usernames currently typing

// ==================
//  DOM refs
// ==================
const sidebar           = document.getElementById("sidebar");
const conversationList  = document.getElementById("conversationList");
const searchInput       = document.getElementById("searchInput");
const newChatBtn        = document.getElementById("newChatBtn");
const newChatModal      = document.getElementById("newChatModal");
const closeModal        = document.getElementById("closeModal");
const cancelNewChat     = document.getElementById("cancelNewChat");
const userSearchInput   = document.getElementById("userSearchInput");
const userSearchResults = document.getElementById("userSearchResults");
const selectedUsersEl   = document.getElementById("selectedUsers");
const groupNameInput    = document.getElementById("groupNameInput");
const groupAvatarPick   = document.getElementById("groupAvatarPick");
const groupCreatePicInput = document.getElementById("groupCreatePicInput");
let groupCreatePicFile = null; // holds file selected during group creation
const emptyState        = document.getElementById("emptyState");
const activeChat        = document.getElementById("activeChat");
const chatName          = document.getElementById("chatName");
const chatAvatar        = document.getElementById("chatAvatar");
const chatStatus        = document.getElementById("chatStatus");
const messagesEl        = document.getElementById("messages");
const messageForm       = document.getElementById("messageForm");
const messageInput      = document.getElementById("messageInput");
const backBtn           = document.getElementById("backBtn");
const attachBtn         = document.getElementById("attachBtn");
const attachMenu        = document.getElementById("attachMenu");
const attachFile        = document.getElementById("attachFile");
const attachImage       = document.getElementById("attachImage");
const attachLocation    = document.getElementById("attachLocation");
const fileInput         = document.getElementById("fileInput");
const imageInput        = document.getElementById("imageInput");
const micBtn            = document.getElementById("micBtn");
const voiceRecording    = document.getElementById("voiceRecording");
const recTimer          = document.getElementById("recTimer");
const cancelRecBtn      = document.getElementById("cancelRecBtn");
const sendRecBtn        = document.getElementById("sendRecBtn");

// Emoji DOM refs
const emojiBtn          = document.getElementById("emojiBtn");
const emojiPicker       = document.getElementById("emojiPicker");
const emojiGrid         = document.getElementById("emojiGrid");
const emojiTabs         = document.getElementById("emojiTabs");
const emojiSearch       = document.getElementById("emojiSearch");

// Profile DOM refs
const profileModal      = document.getElementById("profileModal");
const closeProfileModal = document.getElementById("closeProfileModal");
const cancelProfileBtn  = document.getElementById("cancelProfileBtn");
const saveProfileBtn    = document.getElementById("saveProfileBtn");
const profileBio        = document.getElementById("profileBio");
const bioCharCount      = document.getElementById("bioCharCount");
const currentUserEl     = document.getElementById("currentUser");
const profilePicWrapper = document.getElementById("profilePicWrapper");
const profilePicImg     = document.getElementById("profilePicImg");
const profilePicOverlay = document.getElementById("profilePicOverlay");
const profileAvatar     = document.getElementById("profileAvatar");
const uploadPicBtn      = document.getElementById("uploadPicBtn");
const removePicBtn      = document.getElementById("removePicBtn");
const profilePicInput   = document.getElementById("profilePicInput");
const profileUsername    = document.getElementById("profileUsername");
const profileDisplayName= document.getElementById("profileDisplayName");
const currentPassword   = document.getElementById("currentPassword");
const newPassword       = document.getElementById("newPassword");
const confirmPassword   = document.getElementById("confirmPassword");

// Crop modal refs
const cropModal         = document.getElementById("cropModal");
const closeCropModal    = document.getElementById("closeCropModal");
const cropCanvas        = document.getElementById("cropCanvas");
const cropZoom          = document.getElementById("cropZoom");
const cancelCropBtn     = document.getElementById("cancelCropBtn");
const applyCropBtn      = document.getElementById("applyCropBtn");
const cropContainer     = document.getElementById("cropContainer");

// Story DOM refs
const storiesBar        = document.getElementById("storiesBar");
const storiesList       = document.getElementById("storiesList");
const addStoryBtn       = document.getElementById("addStoryBtn");
const storyModal        = document.getElementById("storyModal");
const closeStoryModal   = document.getElementById("closeStoryModal");
const cancelStoryBtn    = document.getElementById("cancelStoryBtn");
const postStoryBtn      = document.getElementById("postStoryBtn");
const storyText         = document.getElementById("storyText");
const storyTextSection  = document.getElementById("storyTextSection");
const storyMediaSection = document.getElementById("storyMediaSection");
const storyMediaInput   = document.getElementById("storyMediaInput");
const selectStoryMedia  = document.getElementById("selectStoryMedia");
const storyMediaPreview = document.getElementById("storyMediaPreview");
const storyCaption      = document.getElementById("storyCaption");
const storyPrivacy      = document.getElementById("storyPrivacy");
const storyCustomPicker = document.getElementById("storyCustomPicker");
const storyUserSearch   = document.getElementById("storyUserSearch");
const storyCustomResults= document.getElementById("storyCustomResults");
const storySelectedUsers= document.getElementById("storySelectedUsers");
const bgColors          = document.getElementById("bgColors");
const storyViewer       = document.getElementById("storyViewer");
const storyViewerAvatar = document.getElementById("storyViewerAvatar");
const storyViewerName   = document.getElementById("storyViewerName");
const storyViewerTime   = document.getElementById("storyViewerTime");
const storyViewerContent= document.getElementById("storyViewerContent");
const storyProgressBar  = document.getElementById("storyProgressBar");
const closeStoryViewer  = document.getElementById("closeStoryViewer");
const storyPrev         = document.getElementById("storyPrev");
const storyNext         = document.getElementById("storyNext");

// Call DOM refs
const voiceCallBtn         = document.getElementById("voiceCallBtn");
const videoCallBtn         = document.getElementById("videoCallBtn");
const incomingCallOverlay  = document.getElementById("incomingCallOverlay");
const incomingAvatar       = document.getElementById("incomingAvatar");
const incomingName         = document.getElementById("incomingName");
const incomingLabel        = document.getElementById("incomingLabel");
const acceptCallBtn        = document.getElementById("acceptCallBtn");
const rejectCallBtn        = document.getElementById("rejectCallBtn");
const activeCallOverlay    = document.getElementById("activeCallOverlay");
const activeCallAvatar     = document.getElementById("activeCallAvatar");
const activeCallName       = document.getElementById("activeCallName");
const callTimerEl          = document.getElementById("callTimer");
const localVideo           = document.getElementById("localVideo");
const remoteVideo          = document.getElementById("remoteVideo");
const remoteAudio          = document.getElementById("remoteAudio");
const toggleMuteBtn        = document.getElementById("toggleMuteBtn");
const toggleSpeakerBtn     = document.getElementById("toggleSpeakerBtn");
const toggleCameraBtn      = document.getElementById("toggleCameraBtn");
const switchCameraBtn      = document.getElementById("switchCameraBtn");
const endCallBtn           = document.getElementById("endCallBtn");
let currentFacingMode      = "user";   // "user" (front) or "environment" (rear)
let isSpeakerOn            = false;

// ==================
//  Init
// ==================
document.addEventListener("DOMContentLoaded", () => {
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    // Register Service Worker for background notifications
    registerServiceWorker();

    loadConversations();
    setInterval(loadConversations, 3000);

    // Core events
    newChatBtn.addEventListener("click", openNewChatModal);
    closeModal.addEventListener("click", closeNewChatModal);
    cancelNewChat.addEventListener("click", closeNewChatModal);
    userSearchInput.addEventListener("input", debounce(handleUserSearch, 300));
    document.getElementById("groupUserSearch").addEventListener("input", debounce(handleGroupUserSearch, 300));
    messageForm.addEventListener("submit", handleSendMessage);

    // Ctrl+Enter = send, Enter = new line (natural typing)
    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            messageForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + "px";
        // Send typing indicator
        sendTypingIndicator();
    });
    searchInput.addEventListener("input", handleFilterConversations);
    backBtn.addEventListener("click", handleBack);
    newChatModal.addEventListener("click", (e) => { if (e.target === newChatModal) closeNewChatModal(); });

    // Attachment events
    attachBtn.addEventListener("click", (e) => { e.stopPropagation(); attachMenu.classList.toggle("visible"); });
    document.addEventListener("click", () => attachMenu.classList.remove("visible"));
    attachMenu.addEventListener("click", (e) => e.stopPropagation());

    attachFile.addEventListener("click", () => { fileInput.click(); attachMenu.classList.remove("visible"); });
    attachImage.addEventListener("click", () => { imageInput.click(); attachMenu.classList.remove("visible"); });
    attachLocation.addEventListener("click", () => { openLocationPicker(); attachMenu.classList.remove("visible"); });

    fileInput.addEventListener("change", () => { if (fileInput.files[0]) uploadFile(fileInput.files[0], "file"); fileInput.value = ""; });
    imageInput.addEventListener("change", () => { if (imageInput.files[0]) uploadFile(imageInput.files[0], "file"); imageInput.value = ""; });

    // Voice recording events
    micBtn.addEventListener("click", startRecording);
    cancelRecBtn.addEventListener("click", cancelRecording);
    sendRecBtn.addEventListener("click", stopAndSendRecording);

    // Lightbox
    createLightbox();

    // Emoji picker
    initEmojiPicker();
    emojiBtn.addEventListener("click", (e) => { e.stopPropagation(); emojiPicker.classList.toggle("visible"); });
    document.addEventListener("click", (e) => { if (!emojiPicker.contains(e.target)) emojiPicker.classList.remove("visible"); });
    emojiPicker.addEventListener("click", (e) => e.stopPropagation());

    // Profile
    currentUserEl.addEventListener("click", openProfileModal);
    closeProfileModal.addEventListener("click", () => profileModal.classList.remove("visible"));
    cancelProfileBtn.addEventListener("click", () => profileModal.classList.remove("visible"));
    profileModal.addEventListener("click", (e) => { if (e.target === profileModal) profileModal.classList.remove("visible"); });
    saveProfileBtn.addEventListener("click", saveProfile);
    profileBio.addEventListener("input", () => { bioCharCount.textContent = profileBio.value.length; });

    // Profile picture
    uploadPicBtn.addEventListener("click", handleProfilePicSelect);
    profilePicOverlay.addEventListener("click", handleProfilePicSelect);
    profilePicInput.addEventListener("change", handleProfilePicChosen);
    removePicBtn.addEventListener("click", removeProfilePic);

    // Crop modal
    closeCropModal.addEventListener("click", () => { cropModal.style.display = "none"; cropImage = null; });
    cancelCropBtn.addEventListener("click", () => { cropModal.style.display = "none"; cropImage = null; });
    applyCropBtn.addEventListener("click", applyCrop);
    cropZoom.addEventListener("input", handleCropZoom);
    cropCanvas.addEventListener("mousedown", handleCropMouseDown);
    document.addEventListener("mousemove", handleCropMouseMove);
    document.addEventListener("mouseup", handleCropMouseUp);
    cropCanvas.addEventListener("touchstart", handleCropTouchStart, { passive: false });
    document.addEventListener("touchmove", handleCropTouchMove, { passive: false });
    document.addEventListener("touchend", handleCropTouchEnd);

    // Stories
    loadStories();
    setInterval(loadStories, 5000);
    addStoryBtn.addEventListener("click", openStoryModal);
    closeStoryModal.addEventListener("click", () => storyModal.classList.remove("visible"));
    cancelStoryBtn.addEventListener("click", () => storyModal.classList.remove("visible"));
    storyModal.addEventListener("click", (e) => { if (e.target === storyModal) storyModal.classList.remove("visible"); });
    postStoryBtn.addEventListener("click", postStory);
    storyMediaPreview.addEventListener("click", (e) => {
        if (e.target.closest("#selectStoryMedia") || e.target.id === "selectStoryMedia") {
            storyMediaInput.click();
        }
    });
    storyMediaInput.addEventListener("change", handleStoryMediaSelect);
    document.querySelectorAll(".story-type-tab").forEach(tab => {
        tab.addEventListener("click", () => switchStoryTab(tab.dataset.type));
    });
    bgColors.addEventListener("click", (e) => {
        const t = e.target.closest(".bg-color");
        if (t) { bgColors.querySelectorAll(".bg-color").forEach(b => b.classList.remove("active")); t.classList.add("active"); }
    });
    closeStoryViewer.addEventListener("click", closeStoryViewerFn);
    storyPrev.addEventListener("click", () => navigateStory(-1));
    storyNext.addEventListener("click", () => navigateStory(1));

    // Story privacy custom picker
    storyPrivacy.addEventListener("change", () => {
        storyCustomPicker.style.display = storyPrivacy.value === "custom" ? "flex" : "none";
    });
    storyUserSearch.addEventListener("input", debounce(handleStoryUserSearch, 300));

    // Heartbeat — keep online status updated
    let heartbeatInterval = null;
    function startHeartbeat() {
        if (!heartbeatInterval) {
            sendHeartbeat();
            heartbeatInterval = setInterval(sendHeartbeat, 2000);
        }
    }
    function stopHeartbeat() {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
    }
    // Start heartbeat when tab is visible
    if (!document.hidden) startHeartbeat();
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopHeartbeat();
        } else {
            startHeartbeat();
        }
    });

    // Mark offline on tab close / navigation
    window.addEventListener("beforeunload", () => {
        navigator.sendBeacon("/api/offline", "");
    });

    // Track page visibility for service worker
    document.addEventListener("visibilitychange", () => {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: "visibility",
                visible: !document.hidden,
            });
        }
    });

    // Listen for messages from service worker (e.g. open a conversation on notif click)
    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener("message", (event) => {
            if (event.data && event.data.type === "open-conversation" && event.data.conversationId) {
                openConversation(event.data.conversationId);
            }
        });
    }

    // Handle browser back button
    history.replaceState({ view: "list" }, "", "/chat");
    window.addEventListener("popstate", (e) => {
        if (currentConversationId && window.innerWidth <= 768) {
            handleBack();
            // Re-push list state so we don't leave the page
            history.pushState({ view: "list" }, "", "/chat");
        }
    });

    // Call events
    voiceCallBtn.addEventListener("click", () => initiateCall("voice"));
    videoCallBtn.addEventListener("click", () => initiateCall("video"));
    acceptCallBtn.addEventListener("click", acceptCall);
    rejectCallBtn.addEventListener("click", rejectCall);
    endCallBtn.addEventListener("click", endCall);
    toggleMuteBtn.addEventListener("click", toggleMute);
    toggleSpeakerBtn.addEventListener("click", toggleSpeaker);
    toggleCameraBtn.addEventListener("click", toggleCamera);
    switchCameraBtn.addEventListener("click", switchCamera);

    // Poll for incoming calls
    setInterval(checkIncomingCall, 2500);
});

// ==================
//  Conversations
// ==================
async function loadConversations() {
    try {
        const [convRes, usersRes] = await Promise.all([
            fetch("/api/conversations"),
            fetch("/api/users"),
        ]);
        conversations = await convRes.json();
        const allUsers = await usersRes.json();
        const userMap = {};
        allUsers.forEach(u => userMap[u.id] = u);

        // Enrich conversations with online status
        conversations.forEach(c => {
            if (c.type === "direct" && c.members) {
                const me = allUsers.find(u => u.is_me);
                if (me) {
                    const otherId = c.members.find(m => m !== me.id);
                    if (otherId && userMap[otherId]) {
                        c._online = userMap[otherId].online;
                        c._otherBio = userMap[otherId].bio || "";
                        c._otherLastSeen = userMap[otherId].last_seen || "";
                    }
                }
            }
        });

        renderConversations(conversations);

        // Check for new messages and notify
        checkNewMessageNotifications(conversations);

        // Sync conversation state to service worker
        syncServiceWorker(conversations);

        // Update chat header status if a convo is open
        if (currentConversationId) {
            const convo = conversations.find(co => co.id === currentConversationId);
            if (convo) updateChatStatus(convo);
        }
    } catch (err) {
        console.error("Failed to load conversations:", err);
    }
}

function renderConversations(list) {
    const filter = searchInput.value.toLowerCase().trim();
    const filtered = filter ? list.filter(c => c.name.toLowerCase().includes(filter)) : list;

    conversationList.innerHTML = filtered.length === 0
        ? `<div style="padding:24px;text-align:center;color:#6b7280;font-size:0.88rem;">
               ${filter ? "No matches found" : "No conversations yet"}
           </div>`
        : filtered.map(c => {
            const initial = c.name ? c.name[0].toUpperCase() : "?";
            const lastMsg = c.last_message
                ? `<span class="convo-last-msg">${escapeHtml(c.last_message.sender)}: ${escapeHtml(c.last_message.text)}</span>`
                : `<span class="convo-last-msg" style="font-style:italic">No messages yet</span>`;
            const time = c.last_message ? formatTime(c.last_message.timestamp) : "";
            const activeClass = c.id === currentConversationId ? "active" : "";
            const onlineDot = c._online ? `<span class="online-dot"></span>` : "";
            const isGroup = c.type === "group";

            let avatarHtml;
            if (isGroup) {
                if (c.group_pic) {
                    avatarHtml = `<div class="avatar" style="background:transparent;position:relative;overflow:hidden">
                        <img src="${c.group_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">
                    </div>`;
                } else {
                    avatarHtml = `<div class="avatar" style="background:${c.avatar_color || '#6c63ff'};position:relative;overflow:hidden">
                        <svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="7" cy="7" r="3"/><path d="M1 16c0-2.8 2.2-5 5-5h2c2.8 0 5 2.2 5 5"/><circle cx="15" cy="7" r="2.5"/><path d="M19 16c0-2.2-1.8-4-4-4"/></svg>
                    </div>`;
                }
            } else {
                const avatarInner = c.profile_pic
                    ? `<img src="${c.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">${onlineDot}`
                    : `${initial}${onlineDot}`;
                const avatarBg = c.profile_pic ? "transparent" : (c.avatar_color || stringToColor(c.name));
                avatarHtml = `<div class="avatar" style="background:${avatarBg};position:relative;overflow:hidden">${avatarInner}</div>`;
            }

            const nameLabel = isGroup ? `<div class="convo-name">${escapeHtml(c.name)} <span style="font-size:0.7rem;color:var(--text-secondary);font-weight:400;">(${c.members.length})</span></div>` : `<div class="convo-name">${escapeHtml(c.name)}</div>`;

            return `
                <div class="convo-item ${activeClass}" data-id="${c.id}" onclick="openConversation('${c.id}')">
                    ${avatarHtml}
                    <div class="convo-details">
                        ${nameLabel}
                        ${lastMsg}
                    </div>
                    <span class="convo-time">${time}</span>
                </div>`;
        }).join("");
}

function handleFilterConversations() {
    renderConversations(conversations);
}

// ==================
//  Open Conversation
// ==================
async function openConversation(id) {
    currentConversationId = id;
    window.currentConversationId = id;
    const convo = conversations.find(c => c.id === id);

    chatName.textContent = convo ? convo.name : "Chat";
    if (convo && convo.type === "group") {
        // Show group_pic if available, otherwise show SVG icon
        if (convo.group_pic) {
            chatAvatar.innerHTML = `<img src="${convo.group_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            chatAvatar.style.background = "transparent";
        } else {
            chatAvatar.innerHTML = `<svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="7" cy="7" r="3"/><path d="M1 16c0-2.8 2.2-5 5-5h2c2.8 0 5 2.2 5 5"/><circle cx="15" cy="7" r="2.5"/><path d="M19 16c0-2.2-1.8-4-4-4"/></svg>`;
            chatAvatar.style.background = convo.avatar_color || "#6c63ff";
        }
        chatAvatar.style.overflow = "hidden";
    } else if (convo && convo.profile_pic) {
        chatAvatar.innerHTML = `<img src="${convo.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        chatAvatar.style.background = "transparent";
        chatAvatar.style.overflow = "hidden";
    } else {
        chatAvatar.innerHTML = "";
        chatAvatar.textContent = convo && convo.name ? convo.name[0].toUpperCase() : "?";
        chatAvatar.style.background = convo ? (convo.avatar_color || stringToColor(convo.name)) : "#6c63ff";
    }

    // Make chat header clickable for group info
    const chatContact = document.querySelector(".chat-contact");
    if (convo && convo.type === "group") {
        chatContact.style.cursor = "pointer";
        chatContact.onclick = () => openGroupInfo();
    } else {
        chatContact.style.cursor = "";
        chatContact.onclick = null;
    }

    updateChatStatus(convo);

    emptyState.style.display = "none";
    activeChat.classList.add("visible");

    if (window.innerWidth <= 768) sidebar.classList.add("hidden");

    // Push state so browser back button returns to list
    history.pushState({ view: "chat", id }, "", "/chat");

    document.querySelectorAll(".convo-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === id);
    });

    await loadMessages(id);
    startMessagePolling(id);
    startTypingPolling(id);
    messageInput.focus();
}

// ==================
//  Messages
// ==================
async function loadMessages(conversationId, force = false) {
    // Skip reload while user is editing a message inline
    if (isEditingMessage) return;
        try {
            const res = await fetch(`/api/messages/${conversationId}`);
            const msgs = await res.json();
            // Only re-render if there are new messages OR explicitly forced
            const newMsgCount = msgs.length;
            const newTimestamp = msgs.length > 0 ? msgs[msgs.length - 1].timestamp : "";
            if (!force && newMsgCount === lastMessageCount && currentConversationId === conversationId && !isSelectMode) {
                // No new messages, just mark as read, don't re-render
                markMessagesAsRead(conversationId);
                return;
            }
            lastMessageCount = newMsgCount;
            lastMessageTimestamp = newTimestamp;
            renderMessages(msgs);
            // Mark messages as read
            markMessagesAsRead(conversationId);
        } catch (err) {
            console.error("Failed to load messages:", err);
        }
}

function renderMessages(msgs) {
    if (msgs.length === 0) {
        messagesEl.innerHTML = `
            <div style="text-align:center;padding:40px;color:#6b7280;font-size:0.88rem;">
                No messages yet. Say hello! 👋
            </div>`;
        return;
    }

    let html = "";
    let lastDate = "";

    msgs.forEach(m => {
        const msgDate = new Date(m.timestamp).toLocaleDateString();
        if (msgDate !== lastDate) {
            html += `<div class="day-divider">${formatDate(m.timestamp)}</div>`;
            lastDate = msgDate;
        }

        const side = m.is_mine ? "mine" : "other";
        const senderLabel = !m.is_mine ? `<div class="msg-sender">${escapeHtml(m.sender_name)}</div>` : "";
        const avatarHtml = !m.is_mine
            ? (m.profile_pic
                ? `<div class="avatar sm" style="overflow:hidden;background:transparent"><img src="${m.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                : `<div class="avatar sm" style="background:${m.avatar_color || '#6c63ff'}">${m.sender_name[0].toUpperCase()}</div>`)
            : "";

        // Handle deleted messages
        if (m.type === "deleted" || m.deleted_for_everyone) {
            html += `
                <div class="msg-group ${side}">
                    ${avatarHtml}
                    <div class="msg-bubble deleted-msg">
                        <div class="deleted-text">🚫 ${m.is_mine ? "You deleted this message" : "This message was deleted"}</div>
                        <div class="msg-time">${formatTime(m.timestamp)}</div>
                    </div>
                </div>`;
            return;
        }

        let contentHtml = "";
        const type = m.type || "text";

        if (type === "text") {
            contentHtml = `<div>${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>`;
        } else if (type === "file") {
            contentHtml = renderFileMessage(m, side);
        } else if (type === "voice") {
            contentHtml = renderVoiceMessage(m);
        } else if (type === "location") {
            contentHtml = renderLocationMessage(m, side);
        } else if (type === "call") {
            contentHtml = renderCallMessage(m);
        }

        // Forwarded label
        const forwardedLabel = m.forwarded
            ? `<div class="msg-forwarded"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 8l4-4 4 4"/><path d="M6 4v7"/></svg> Forwarded${m.forwarded_from ? ' from ' + escapeHtml(m.forwarded_from) : ''}</div>`
            : "";

        // Edited label
        const editedLabel = m.edited ? `<span class="msg-edited">edited</span>` : "";

        // Use server-calculated flags (avoids timezone mismatch on hosted servers)
        const canEdit = !!m.can_edit;
        const canDeleteForEveryone = !!m.can_delete_for_everyone;

        // Selection checkbox
        const selectedClass = selectedMessages.has(m.id) ? "selected" : "";
        const selectCheckbox = isSelectMode
            ? `<div class="msg-select-check ${selectedMessages.has(m.id) ? 'checked' : ''}" onclick="toggleMessageSelect('${m.id}', event)">
                   <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 8 7 12 13 4"/></svg>
               </div>`
            : "";

        // Call messages use a special centered layout
        if (type === "call") {
            html += `
                <div class="msg-call-event">
                    ${contentHtml}
                    <div class="msg-time" style="text-align:center;margin-top:2px">${formatTime(m.timestamp)}</div>
                </div>`;
        } else {
            html += `
                <div class="msg-group ${side} ${selectedClass}" data-msg-id="${m.id}"
                     data-can-edit="${canEdit}" data-can-delete-everyone="${canDeleteForEveryone}"
                     data-is-mine="${m.is_mine}" data-msg-type="${type}"
                     oncontextmenu="showMsgContextMenu(event, '${m.id}')"
                     onclick="handleMsgClick(event, '${m.id}')">
                    ${avatarHtml}
                    <div class="msg-bubble">
                        ${senderLabel}
                        ${forwardedLabel}
                        ${contentHtml}
                        <div class="msg-time">${editedLabel}${formatTime(m.timestamp)}${m.is_mine ? getReadReceiptIcon(m) : ''}</div>
                        ${selectCheckbox}
                    </div>
                </div>`;
        }
    });

    messagesEl.innerHTML = html;
    // Only auto-scroll if user is near the bottom (within 100px)
    const isNearBottom = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 100;
    if (isNearBottom) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Restore pause icon if a voice note is currently playing
    if (currentAudio && currentAudioId) {
        const icon = document.getElementById(`vicon-${currentAudioId}`);
        if (icon) {
            icon.innerHTML = '<rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/>';
        }
    }

    // Store messages for context menu use
    messagesEl._msgData = msgs;
}

function renderFileMessage(m, side) {
    const ft = m.file_type || "file";
    const url = m.file_url || "";
    const name = m.file_name || "File";
    const size = formatFileSize(m.file_size || 0);

    if (ft === "image") {
        return `<img class="msg-image chat-media-thumb" src="${url}" alt="${escapeHtml(name)}" onclick="openLightbox('${url}')" loading="lazy">`;
    }
    if (ft === "video") {
        return `<video class="msg-video chat-media-thumb" controls preload="metadata"><source src="${url}"></video>`;
    }
    if (ft === "audio") {
        return `<audio controls style="max-width:240px;margin-top:4px;"><source src="${url}"></audio>`;
    }

    // Generic file card
    const icon = getFileEmoji(name);
    return `
        <a class="msg-file-card" href="${url}" target="_blank" download="${escapeHtml(name)}">
            <div class="file-icon-box">${icon}</div>
            <div class="file-info">
                <div class="file-name">${escapeHtml(name)}</div>
                <div class="file-size">${size}</div>
            </div>
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 14v2h12v-2M9 3v9m0 0l-3-3m3 3l3-3"/></svg>
        </a>`;
}

function renderVoiceMessage(m) {
    const url = m.file_url || "";
    const dur = m.duration ? formatDuration(m.duration) : "0:00";
    const uid = m.id;
    // Generate random wave bars
    let bars = "";
    for (let i = 0; i < 24; i++) {
        const h = Math.floor(Math.random() * 20) + 6;
        bars += `<span class="bar" style="height:${h}px"></span>`;
    }
    return `
        <div class="msg-voice" data-url="${url}" data-id="${uid}">
            <button class="voice-play-btn" onclick="toggleVoicePlay('${uid}', '${url}')">
                <svg id="vicon-${uid}" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><polygon points="4,2 14,8 4,14"/></svg>
            </button>
            <div class="voice-wave" id="vwave-${uid}">${bars}</div>
            <span class="voice-duration" id="vdur-${uid}">${dur}</span>
        </div>`;
}

function renderLocationMessage(m, side) {
    const lat = m.latitude || 0;
    const lng = m.longitude || 0;
    const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const z = 15;
    const n = Math.pow(2, z);
    const tileX = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    // Calculate pixel offset of the pin within the tile (120x120 px)
    const tileSize = 120;
    // Convert lat/lng to Web Mercator projection
    const worldCoordX = ((lng + 180) / 360) * tileSize * n;
    const sinLat = Math.sin(lat * Math.PI / 180);
    const worldCoordY = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * tileSize * n;
    const x = worldCoordX - tileX * tileSize;
    const y = worldCoordY - tileY * tileSize;

    const mapPreviewId = `map-preview-${Math.random().toString(36).substr(2, 9)}`;
    setTimeout(() => {
      const map = L.map(mapPreviewId, {zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false}).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
      L.marker([lat, lng]).addTo(map);
    }, 100);
    return `
        <a class="msg-location" href="${mapUrl}" target="_blank" rel="noopener">
            <div id="${mapPreviewId}" class="chat-media-thumb" style="height:180px;width:180px;border-radius:8px;"></div>
        </a>`;
}

// Voice playback
let currentAudio = null;
let currentAudioId = null;

// ==================
//  Message Actions (Context Menu, Select, Forward, Edit, Delete)
// ==================

function getMsgData(msgId) {
    if (!messagesEl._msgData) return null;
    return messagesEl._msgData.find(m => m.id === msgId);
}

function showMsgContextMenu(e, msgId) {
    e.preventDefault();
    e.stopPropagation();

    if (isSelectMode) {
        toggleMessageSelect(msgId, e);
        return;
    }

    // Remove any existing context menu
    closeMsgContextMenu();

    const msgEl = e.currentTarget;
    const canEdit = msgEl.dataset.canEdit === "true";
    const canDeleteEveryone = msgEl.dataset.canDeleteEveryone === "true";
    const isMine = msgEl.dataset.isMine === "true";
    const msgType = msgEl.dataset.msgType;
    const msg = getMsgData(msgId);

    let menuHtml = "";

    // Reply / Copy for text messages
    if (msgType === "text" && msg) {
        menuHtml += `<button class="ctx-menu-item" onclick="copyMessageText('${msgId}')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M5 11H4a1 1 0 01-1-1V4a1 1 0 011-1h6a1 1 0 011 1v1"/></svg>
            Copy
        </button>`;
    }

    // Edit (own text messages within 15 min)
    if (canEdit) {
        menuHtml += `<button class="ctx-menu-item" onclick="startEditMessage('${msgId}')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 1.5a2.12 2.12 0 013 3L5 13.5 1 15l1.5-4z"/></svg>
            Edit
        </button>`;
    }

    // Forward
    menuHtml += `<button class="ctx-menu-item" onclick="openForwardModal(['${msgId}'])">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 8l-6-5v3C4 6 2 8 1 12c2-3 4-4 8-4v3z"/></svg>
        Forward
    </button>`;

    // Message Info (read receipts) — only for own messages
    if (isMine) {
        menuHtml += `<button class="ctx-menu-item" onclick="showMessageInfo('${msgId}')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 7-8 7 8 7 8-4 8-7 8-7-8-7-8z"/><circle cx="8" cy="12" r="3"/></svg>
            Message info
        </button>`;
    }

    // Select
    menuHtml += `<button class="ctx-menu-item" onclick="enterSelectMode('${msgId}')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><polyline points="5 8 7 10 11 5"/></svg>
        Select
    </button>`;

    // Delete for everyone (own messages within 15 min)
    if (canDeleteEveryone) {
        menuHtml += `<button class="ctx-menu-item danger" onclick="deleteForEveryone('${msgId}')">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h10M6 6V4a1 1 0 011-1h2a1 1 0 011 1v2m1 0v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6h10"/></svg>
            Delete for everyone
        </button>`;
    }

    // Delete for me (always available)
    menuHtml += `<button class="ctx-menu-item danger" onclick="deleteForMe('${msgId}')">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h10M6 6V4a1 1 0 011-1h2a1 1 0 011 1v2m1 0v7a2 2 0 01-2 2H5a2 2 0 01-2-2V6h10"/></svg>
        Delete for me
    </button>`;

    const menu = document.createElement("div");
    menu.className = "msg-context-menu";
    menu.id = "msgContextMenu";
    menu.innerHTML = menuHtml;

    document.body.appendChild(menu);

    // Position the menu near the click
    const rect = msgEl.getBoundingClientRect();
    let top = e.clientY;
    let left = e.clientX;

    // Adjust if menu would overflow
    requestAnimationFrame(() => {
        const menuRect = menu.getBoundingClientRect();
        if (top + menuRect.height > window.innerHeight) top = window.innerHeight - menuRect.height - 10;
        if (left + menuRect.width > window.innerWidth) left = window.innerWidth - menuRect.width - 10;
        if (top < 10) top = 10;
        if (left < 10) left = 10;
        menu.style.top = top + "px";
        menu.style.left = left + "px";
        menu.classList.add("visible");
    });

    // Close on click elsewhere
    setTimeout(() => {
        document.addEventListener("click", closeMsgContextMenu, { once: true });
    }, 10);
}

function closeMsgContextMenu() {
    const menu = document.getElementById("msgContextMenu");
    if (menu) menu.remove();
}

function handleMsgClick(e, msgId) {
    if (isSelectMode) {
        e.preventDefault();
        e.stopPropagation();
        toggleMessageSelect(msgId, e);
    }
}

// --- Copy Message Text ---
function copyMessageText(msgId) {
    closeMsgContextMenu();
    const msg = getMsgData(msgId);
    if (msg && msg.text) {
        navigator.clipboard.writeText(msg.text).then(() => {
            showActionToast("Message copied");
        }).catch(() => {});
    }
}

// --- Edit Message ---
function startEditMessage(msgId) {
    closeMsgContextMenu();
    isEditingMessage = true;
    const msg = getMsgData(msgId);
    if (!msg) return;

    const msgEl = document.querySelector(`.msg-group[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    const bubble = msgEl.querySelector(".msg-bubble");
    if (!bubble) return;

    // Replace bubble content with edit input
    const textDiv = bubble.querySelector("div:not(.msg-sender):not(.msg-time):not(.msg-forwarded)");
    if (!textDiv) return;
    const originalText = msg.text;

    textDiv.innerHTML = `
        <div class="msg-edit-box">
            <textarea class="msg-edit-input" maxlength="2000" id="editMsgInput" rows="1">${escapeHtml(originalText)}</textarea>
            <div class="msg-edit-actions">
                <button class="msg-edit-cancel" onclick="cancelEditMessage('${msgId}')">Cancel</button>
                <button class="msg-edit-save" onclick="saveEditMessage('${msgId}')">Save</button>
            </div>
        </div>`;

    const input = document.getElementById("editMsgInput");
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    // Auto-resize on input
    input.addEventListener("input", () => {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });

    // Shift+Enter = new line, Enter = save, Escape = cancel
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            saveEditMessage(msgId);
        }
        if (e.key === "Escape") {
            cancelEditMessage(msgId);
        }
    });
}

function cancelEditMessage(msgId) {
    isEditingMessage = false;
    loadMessages(currentConversationId);
}

async function saveEditMessage(msgId) {
    const input = document.getElementById("editMsgInput");
    if (!input) return;
    const newText = input.value.trim();
    if (!newText) return;

    try {
        const res = await fetch(`/api/messages/${msgId}/edit`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: newText }),
        });
        const data = await res.json();
        if (res.ok) {
            isEditingMessage = false;
            showActionToast("Message edited");
            await loadMessages(currentConversationId);
        } else {
            alert(data.error || "Failed to edit message");
        }
    } catch (err) {
        console.error("Edit failed:", err);
    }
}

// --- Delete For Everyone ---
async function deleteForEveryone(msgId) {
    closeMsgContextMenu();
    if (!confirm("Delete this message for everyone? This cannot be undone.")) return;

    try {
        const res = await fetch(`/api/messages/${msgId}/delete-for-everyone`, { method: "DELETE" });
        const data = await res.json();
        if (res.ok) {
            showActionToast("Message deleted for everyone");
            await loadMessages(currentConversationId);
            loadConversations();
        } else {
            alert(data.error || "Failed to delete");
        }
    } catch (err) {
        console.error("Delete for everyone failed:", err);
    }
}

// --- Delete For Me ---
async function deleteForMe(msgId) {
    closeMsgContextMenu();
    try {
        const res = await fetch(`/api/messages/${msgId}/delete-for-me`, { method: "DELETE" });
        if (res.ok) {
            showActionToast("Message deleted");
            await loadMessages(currentConversationId);
            loadConversations();
        }
    } catch (err) {
        console.error("Delete for me failed:", err);
    }
}

// --- Select Mode ---
function enterSelectMode(firstMsgId) {
    closeMsgContextMenu();
    isSelectMode = true;
    selectedMessages.clear();
    if (firstMsgId) selectedMessages.add(firstMsgId);

    // Show selection toolbar
    const toolbar = document.getElementById("selectionToolbar");
    if (toolbar) toolbar.classList.add("visible");

    updateSelectionCount();
    loadMessages(currentConversationId);  // Re-render with checkboxes
}

function exitSelectMode() {
    isSelectMode = false;
    selectedMessages.clear();
    const toolbar = document.getElementById("selectionToolbar");
    if (toolbar) toolbar.classList.remove("visible");
    // force reload so leftover .selected classes are cleared
    loadMessages(currentConversationId, true);
}

function toggleMessageSelect(msgId, e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
    if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
    } else {
        selectedMessages.add(msgId);
    }

    // Update visual without full re-render
    const msgEl = document.querySelector(`.msg-group[data-msg-id="${msgId}"]`);
    if (msgEl) {
        msgEl.classList.toggle("selected", selectedMessages.has(msgId));
        const check = msgEl.querySelector(".msg-select-check");
        if (check) check.classList.toggle("checked", selectedMessages.has(msgId));
    }

    updateSelectionCount();

    if (selectedMessages.size === 0) {
        exitSelectMode();
    }
}

function updateSelectionCount() {
    const countEl = document.getElementById("selectionCount");
    if (countEl) countEl.textContent = selectedMessages.size;
}

// --- Forward ---
function forwardSelected() {
    if (selectedMessages.size === 0) return;
    openForwardModal([...selectedMessages]);
}

function openForwardModal(msgIds) {
    closeMsgContextMenu();

    const modal = document.getElementById("forwardModal");
    if (!modal) return;

    modal.dataset.msgIds = JSON.stringify(msgIds);

    // Clear state
    document.getElementById("forwardSearch").value = "";
    document.getElementById("forwardConvoList").innerHTML = "";
    forwardSelectedConvos = new Set();
    updateForwardSendBtn();

    // Load conversations into forward modal
    renderForwardConversations("");
    modal.classList.add("visible");
    setTimeout(() => document.getElementById("forwardSearch").focus(), 100);
}

let forwardSelectedConvos = new Set();

function renderForwardConversations(filter) {
    const list = document.getElementById("forwardConvoList");
    const filtered = filter
        ? conversations.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()))
        : conversations;

    list.innerHTML = filtered.length === 0
        ? `<div style="padding:16px;text-align:center;color:#6b7280;font-size:0.85rem;">No conversations found</div>`
        : filtered.map(c => {
            const initial = c.name ? c.name[0].toUpperCase() : "?";
            const avatarBg = c.profile_pic ? "transparent" : (c.avatar_color || stringToColor(c.name));
            const avatarContent = c.profile_pic
                ? `<img src="${c.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
                : initial;
            const checked = forwardSelectedConvos.has(c.id) ? "checked" : "";
            return `
                <div class="forward-convo-item ${checked}" data-id="${c.id}" onclick="toggleForwardConvo('${c.id}')">
                    <div class="avatar sm" style="background:${avatarBg};overflow:hidden">${avatarContent}</div>
                    <span class="forward-convo-name">${escapeHtml(c.name)}</span>
                    <div class="forward-check ${checked}">
                        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="2 7 5.5 10.5 12 3.5"/></svg>
                    </div>
                </div>`;
        }).join("");
}

function toggleForwardConvo(convoId) {
    if (forwardSelectedConvos.has(convoId)) {
        forwardSelectedConvos.delete(convoId);
    } else {
        forwardSelectedConvos.add(convoId);
    }
    const filter = document.getElementById("forwardSearch").value.trim();
    renderForwardConversations(filter);
    updateForwardSendBtn();
}

function updateForwardSendBtn() {
    const btn = document.getElementById("forwardSendBtn");
    if (btn) {
        btn.disabled = forwardSelectedConvos.size === 0;
        btn.textContent = forwardSelectedConvos.size > 0
            ? `Forward (${forwardSelectedConvos.size})`
            : "Forward";
    }
}

function closeForwardModal() {
    const modal = document.getElementById("forwardModal");
    if (modal) modal.classList.remove("visible");
}

async function sendForward() {
    const modal = document.getElementById("forwardModal");
    if (!modal) return;

    const msgIds = JSON.parse(modal.dataset.msgIds || "[]");
    const targetIds = [...forwardSelectedConvos];

    if (msgIds.length === 0 || targetIds.length === 0) return;

    const btn = document.getElementById("forwardSendBtn");
    btn.textContent = "Forwarding…";
    btn.disabled = true;

    try {
        const res = await fetch("/api/messages/forward", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message_ids: msgIds,
                target_conversation_ids: targetIds,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            showActionToast(`Forwarded to ${targetIds.length} chat${targetIds.length > 1 ? 's' : ''}`);
            closeForwardModal();
            if (isSelectMode) exitSelectMode();
            loadConversations();
            if (currentConversationId) loadMessages(currentConversationId);
        } else {
            alert(data.error || "Forward failed");
        }
    } catch (err) {
        console.error("Forward failed:", err);
    } finally {
        btn.textContent = "Forward";
        btn.disabled = false;
    }
}

// --- Share (Web Share API) ---
function shareSelected() {
    if (selectedMessages.size === 0) return;
    const msgs = messagesEl._msgData || [];
    const selectedTexts = msgs
        .filter(m => selectedMessages.has(m.id) && m.text)
        .map(m => `${m.sender_name}: ${m.text}`)
        .join("\n");

    if (!selectedTexts) {
        showActionToast("No text to share");
        return;
    }

    if (navigator.share) {
        navigator.share({
            title: "QuickChat Messages",
            text: selectedTexts,
        }).catch(() => {});
    } else {
        navigator.clipboard.writeText(selectedTexts).then(() => {
            showActionToast("Messages copied to clipboard");
        }).catch(() => {});
    }
    exitSelectMode();
}

// --- Delete selected for me ---
async function deleteSelectedForMe() {
    if (selectedMessages.size === 0) return;
    const ids = [...selectedMessages];

    for (const id of ids) {
        try {
            await fetch(`/api/messages/${id}/delete-for-me`, { method: "DELETE" });
        } catch {}
    }

    showActionToast(`${ids.length} message${ids.length > 1 ? 's' : ''} deleted`);
    exitSelectMode();
    await loadMessages(currentConversationId);
    loadConversations();
}

// --- Small toast for action feedback ---
function showActionToast(text) {
    let container = document.getElementById("actionToastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "actionToastContainer";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = "action-toast";
    toast.textContent = text;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));
    setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => toast.remove(), 250);
    }, 2000);
}

function toggleVoicePlay(id, url) {
    const icon = document.getElementById(`vicon-${id}`);

    if (currentAudioId === id && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        currentAudioId = null;
        icon.innerHTML = '<polygon points="4,2 14,8 4,14"/>';
        return;
    }

    if (currentAudio) {
        currentAudio.pause();
        const prevIcon = document.getElementById(`vicon-${currentAudioId}`);
        if (prevIcon) prevIcon.innerHTML = '<polygon points="4,2 14,8 4,14"/>';
    }

    currentAudio = new Audio(url);
    currentAudioId = id;
    icon.innerHTML = '<rect x="3" y="2" width="4" height="12" rx="1"/><rect x="9" y="2" width="4" height="12" rx="1"/>';

    currentAudio.play();
    currentAudio.onended = () => {
        icon.innerHTML = '<polygon points="4,2 14,8 4,14"/>';
        currentAudio = null;
        currentAudioId = null;
    };
}

function startMessagePolling(conversationId) {
    if (pollTimers.messages) clearInterval(pollTimers.messages);
    pollTimers.messages = setInterval(() => {
        if (currentConversationId === conversationId) {
            loadMessages(conversationId);
        }
    }, 2000);
}

// ==================
//  Call Message Rendering
// ==================
function renderCallMessage(m) {
    const callType = m.call_type || "voice";
    const callStatus = m.call_status || "ended";
    const dur = m.call_duration || 0;

    let icon, label;
    if (callType === "video") {
        icon = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="9" height="8" rx="1"/><path d="M11 7l3-2v6l-3-2"/></svg>`;
    } else {
        icon = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h3l2 4-1.5 1.5a11 11 0 005 5L12 12l4 2v3a1 1 0 01-1 1C7 18-1 10 1 2a1 1 0 011-1h0z"/></svg>`;
    }

    if (callStatus === "missed" || callStatus === "rejected") {
        label = callStatus === "missed" ? "Missed call" : "Call declined";
        return `<div class="call-event missed">${icon} <span>${label}</span></div>`;
    }

    const durText = dur > 0 ? formatCallDuration(dur) : "";
    const typeLabel = callType === "video" ? "Video call" : "Voice call";
    label = durText ? `${typeLabel} • ${durText}` : typeLabel;
    return `<div class="call-event">${icon} <span>${label}</span></div>`;
}

function formatCallDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ==================
//  Send Text Message
// ==================
async function handleSendMessage(e) {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !currentConversationId) return;

    messageInput.value = "";
    messageInput.style.height = "auto";

    try {
        const res = await fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: currentConversationId,
                text: text,
                type: "text",
            }),
        });

        if (res.ok) {
            await loadMessages(currentConversationId);
            loadConversations();
        }
    } catch (err) {
        console.error("Failed to send message:", err);
    }
}

// ==================
//  File Upload
// ==================
async function uploadFile(file, type = "file") {
    if (!currentConversationId) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("conversation_id", currentConversationId);
    formData.append("type", type);

    try {
        const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
        });

        if (res.ok) {
            await loadMessages(currentConversationId);
            loadConversations();
        }
    } catch (err) {
        console.error("Upload failed:", err);
    }
}

// ==================
//  Location Sharing
// ==================
function handleShareLocation() {
    if (!currentConversationId) return;

    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    // Show a simple loading indicator
    const btn = attachLocation;
    btn.innerHTML = `<span class="attach-icon location-icon"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 9 9" to="360 9 9" dur="1s" repeatCount="indefinite"/></circle></svg></span><span>Getting location…</span>`;

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            try {
                await fetch("/api/messages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        conversation_id: currentConversationId,
                        type: "location",
                        text: "Shared a location",
                        latitude: lat,
                        longitude: lng,
                    }),
                });
                await loadMessages(currentConversationId);
                loadConversations();
            } catch (err) {
                console.error("Location send failed:", err);
            }

            // Restore button
            btn.innerHTML = `<span class="attach-icon location-icon"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 1C5.7 1 3 3.7 3 7c0 5 6 10 6 10s6-5 6-10c0-3.3-2.7-6-6-6z"/><circle cx="9" cy="7" r="2"/></svg></span><span>Location</span>`;
        },
        (err) => {
            alert("Could not get your location. Please allow location access.");
            btn.innerHTML = `<span class="attach-icon location-icon"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 1C5.7 1 3 3.7 3 7c0 5 6 10 6 10s6-5 6-10c0-3.3-2.7-6-6-6z"/><circle cx="9" cy="7" r="2"/></svg></span><span>Location</span>`;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ==================
//  Voice Recording
// ==================
async function startRecording() {
    if (!currentConversationId) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        recStart = Date.now();

        // Show recording UI
        messageForm.style.display = "none";
        voiceRecording.style.display = "flex";

        recInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - recStart) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            recTimer.textContent = `${m}:${s.toString().padStart(2, "0")}`;
        }, 200);

    } catch (err) {
        alert("Microphone access denied or not available.");
        console.error("Mic error:", err);
    }
}

function cancelRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    mediaRecorder = null;
    audioChunks = [];
    clearInterval(recInterval);

    voiceRecording.style.display = "none";
    messageForm.style.display = "flex";
    recTimer.textContent = "0:00";
}

function stopAndSendRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;

    const duration = (Date.now() - recStart) / 1000;

    mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: "audio/webm" });
        const file = new File([blob], "voice_note.webm", { type: "audio/webm" });

        const formData = new FormData();
        formData.append("file", file);
        formData.append("conversation_id", currentConversationId);
        formData.append("type", "voice");
        formData.append("duration", duration.toFixed(1));

        try {
            await fetch("/api/upload", { method: "POST", body: formData });
            await loadMessages(currentConversationId);
            loadConversations();
        } catch (err) {
            console.error("Voice upload failed:", err);
        }

        mediaRecorder.stream.getTracks().forEach(t => t.stop());
        mediaRecorder = null;
        audioChunks = [];
    };

    mediaRecorder.stop();
    clearInterval(recInterval);
    voiceRecording.style.display = "none";
    messageForm.style.display = "flex";
    recTimer.textContent = "0:00";
}

// ==================
//  Lightbox
// ==================
function createLightbox() {
    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";
    overlay.id = "lightbox";
    overlay.innerHTML = `<img src="" alt="Preview">`;
    overlay.addEventListener("click", () => overlay.classList.remove("visible"));
    document.body.appendChild(overlay);
}

function openLightbox(url) {
    const lb = document.getElementById("lightbox");
    lb.querySelector("img").src = url;
    lb.classList.add("visible");
}

// ==================
//  New Chat Modal (Tabbed: Chat / Group)
// ==================
let currentNewChatTab = 'chat';    // 'chat' | 'group'
let groupColor = '#6c63ff';

function openNewChatModal() {
    selectedUsers = [];
    userSearchInput.value = "";
    userSearchResults.innerHTML = "";
    selectedUsersEl.innerHTML = "";
    groupNameInput.value = "";
    document.getElementById("groupDescInput").value = "";
    document.getElementById("groupUserSearch").value = "";
    document.getElementById("groupUserResults").innerHTML = "";
    document.getElementById("groupMemberCount").innerHTML = "";
    groupColor = '#6c63ff';
    updateGroupAvatarColor();
    switchNewChatTab('chat');
    newChatModal.classList.add("visible");
    setTimeout(() => userSearchInput.focus(), 100);
}

function closeNewChatModal() {
    newChatModal.classList.remove("visible");
}

function switchNewChatTab(tab) {
    currentNewChatTab = tab;
    document.getElementById("tabNewChat").classList.toggle("active", tab === 'chat');
    document.getElementById("tabNewGroup").classList.toggle("active", tab === 'group');
    document.getElementById("panelChat").style.display = tab === 'chat' ? '' : 'none';
    document.getElementById("panelGroup").style.display = tab === 'group' ? '' : 'none';
    document.getElementById("newChatTitle").textContent = tab === 'chat' ? 'New Chat' : 'Create Group';

    // Reset group to step 1 when switching
    if (tab === 'group') {
        goToGroupStep1();
        setupGroupColorPicker();
    } else {
        setTimeout(() => userSearchInput.focus(), 100);
    }
}

let defaultGroupAvatarSVG = '';

function setupGroupColorPicker() {
    document.querySelectorAll('.group-color-dot').forEach(dot => {
        dot.classList.toggle('selected', dot.dataset.color === groupColor);
        dot.onclick = () => {
            groupColor = dot.dataset.color;
            document.querySelectorAll('.group-color-dot').forEach(d => d.classList.remove('selected'));
            dot.classList.add('selected');
            updateGroupAvatarColor();
        };
    });
}

function updateGroupAvatarColor() {
    const av = document.getElementById("groupAvatarPick");
    if (!av) return;
    // if a pic has been chosen, keep that image instead of color
    if (groupCreatePicFile) return;
    av.style.background = groupColor;
    if (defaultGroupAvatarSVG) av.innerHTML = defaultGroupAvatarSVG;
}

function goToGroupStep1() {
    document.getElementById("groupStep1").style.display = '';
    document.getElementById("groupStep1Footer").style.display = '';
    document.getElementById("groupStep2").style.display = 'none';
    document.getElementById("groupStep2Footer").style.display = 'none';
    setTimeout(() => groupNameInput.focus(), 100);

    // reset picture selection
    groupCreatePicFile = null;
    if (groupCreatePicInput) groupCreatePicInput.value = "";
    const av = document.getElementById("groupAvatarPick");
    if (av) {
        av.style.background = groupColor;
        if (defaultGroupAvatarSVG) av.innerHTML = defaultGroupAvatarSVG;
    }
}

// handle avatar pick interactions
if (groupAvatarPick) {
    defaultGroupAvatarSVG = groupAvatarPick.innerHTML;
    groupAvatarPick.onclick = () => {
        if (groupCreatePicFile) {
            // clicking again clears selection
            groupCreatePicFile = null;
            groupAvatarPick.style.background = groupColor;
            groupAvatarPick.innerHTML = defaultGroupAvatarSVG;
        } else {
            groupCreatePicInput.click();
        }
    };
}

// attach file change listener for creation input
if (groupCreatePicInput) {
    groupCreatePicInput.addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;
        groupCreatePicFile = file;
        const reader = new FileReader();
        reader.onload = e => {
            const av = document.getElementById("groupAvatarPick");
            if (av) {
                av.style.background = `url(${e.target.result}) center/cover`;
                av.innerHTML = '';
            }
        };
        reader.readAsDataURL(file);
    });
}

function goToGroupStep2() {
    const name = groupNameInput.value.trim();
    if (!name) {
        groupNameInput.focus();
        groupNameInput.style.borderColor = '#ef4444';
        setTimeout(() => groupNameInput.style.borderColor = '', 1500);
        return;
    }
    document.getElementById("groupStep1").style.display = 'none';
    document.getElementById("groupStep1Footer").style.display = 'none';
    document.getElementById("groupStep2").style.display = '';
    document.getElementById("groupStep2Footer").style.display = '';
    renderSelectedUsers();
    updateGroupMemberCount();
    setTimeout(() => document.getElementById("groupUserSearch").focus(), 100);
}

function updateGroupMemberCount() {
    const count = selectedUsers.length;
    document.getElementById("groupMemberCount").innerHTML =
        count === 0 ? '<div style="padding:10px;text-align:center;color:#6b7280;font-size:0.82rem;">Search and add at least 1 member</div>'
                    : `<div style="padding:6px 0;color:#6b7280;font-size:0.8rem;">${count} member${count > 1 ? 's' : ''} selected</div>`;
}

async function handleUserSearch() {
    const query = userSearchInput.value.trim();
    if (query.length < 1) { userSearchResults.innerHTML = ""; return; }

    try {
        const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
        const users = await res.json();
        renderDirectChatResults(users);
    } catch (err) { console.error("Search failed:", err); }
}

function renderDirectChatResults(users) {
    if (users.length === 0) {
        userSearchResults.innerHTML = `<div style="padding:12px;text-align:center;color:#6b7280;font-size:0.85rem;">No users found</div>`;
        return;
    }
    userSearchResults.innerHTML = users.map(u => `
        <div class="user-result-item" onclick='startDirectChat(${JSON.stringify(u).replace(/'/g, "&#39;")})'>
            ${u.profile_pic
                ? `<div class="avatar sm" style="overflow:hidden;background:transparent"><img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                : `<div class="avatar sm" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>`}
            <span class="username">${escapeHtml(u.username)}</span>
            <span class="status-dot ${u.online ? 'online' : 'offline'}"></span>
        </div>`).join("");
}

async function startDirectChat(user) {
    // Start 1:1 conversation directly
    try {
        const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ members: [user.id], type: "direct", name: "" }),
        });
        const data = await res.json();
        closeNewChatModal();
        await loadConversations();
        openConversation(data.id);
    } catch (err) { console.error("Failed to create conversation:", err); }
}

async function handleGroupUserSearch() {
    const query = document.getElementById("groupUserSearch").value.trim();
    const resultsEl = document.getElementById("groupUserResults");
    if (query.length < 1) { resultsEl.innerHTML = ""; return; }

    try {
        const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
        const users = await res.json();
        const selectedIds = selectedUsers.map(u => u.id);
        const available = users.filter(u => !selectedIds.includes(u.id));

        resultsEl.innerHTML = available.length === 0
            ? `<div style="padding:12px;text-align:center;color:#6b7280;font-size:0.85rem;">No users found</div>`
            : available.map(u => `
                <div class="user-result-item" onclick='selectGroupUser(${JSON.stringify(u).replace(/'/g, "&#39;")})'>
                    ${u.profile_pic
                        ? `<div class="avatar sm" style="overflow:hidden;background:transparent"><img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                        : `<div class="avatar sm" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>`}
                    <span class="username">${escapeHtml(u.username)}</span>
                    <span class="status-dot ${u.online ? 'online' : 'offline'}"></span>
                </div>`).join("");
    } catch (err) { console.error("Search failed:", err); }
}

function selectGroupUser(user) {
    if (selectedUsers.find(u => u.id === user.id)) return;
    selectedUsers.push(user);
    renderSelectedUsers();
    document.getElementById("groupUserSearch").value = "";
    document.getElementById("groupUserResults").innerHTML = "";
    updateGroupMemberCount();
}

function removeSelectedUser(id) {
    selectedUsers = selectedUsers.filter(u => u.id !== id);
    renderSelectedUsers();
    updateGroupMemberCount();
}

function renderSelectedUsers() {
    selectedUsersEl.innerHTML = selectedUsers.map(u => `
        <span class="selected-tag">
            <span class="avatar sm" style="background:${u.avatar_color};width:22px;height:22px;font-size:0.65rem;">${u.username[0].toUpperCase()}</span>
            ${escapeHtml(u.username)}
            <span class="remove-tag" onclick="removeSelectedUser('${u.id}')">&times;</span>
        </span>`).join("");
}

async function handleCreateGroup() {
    const name = groupNameInput.value.trim();
    if (!name) return;
    if (selectedUsers.length === 0) {
        document.getElementById("groupUserSearch").focus();
        return;
    }

    const payload = {
        members: selectedUsers.map(u => u.id),
        type: "group",
        name: name,
        color: groupColor,
        description: document.getElementById("groupDescInput").value.trim(),
    };

    try {
        const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        // if a picture was chosen during creation, upload it now
        if (groupCreatePicFile) {
            try {
                const fd = new FormData();
                fd.append('picture', groupCreatePicFile);
                await fetch(`/api/groups/${data.id}/picture`, {
                    method: 'POST',
                    body: fd
                });
            } catch (uploadErr) {
                console.error('Failed to upload group picture:', uploadErr);
            }
        }
        closeNewChatModal();
        await loadConversations();
        openConversation(data.id);
    } catch (err) { console.error("Failed to create group:", err); }
}

// ==================
//  Notifications
// ==================
function checkNewMessageNotifications(convos) {
    const myName = window.CURRENT_USERNAME || "";
    convos.forEach(c => {
        if (!c.last_message) return;
        const key = c.id;
        const ts = c.last_message.timestamp;
        const sender = c.last_message.sender;

        const prev = lastKnownMessages[key];
        if (!prev) {
            // First load — just record, don't notify
            lastKnownMessages[key] = { timestamp: ts, sender };
            return;
        }

        // If timestamp changed and sender is not me
        if (ts !== prev.timestamp && sender !== myName) {
            lastKnownMessages[key] = { timestamp: ts, sender };

            // Don't notify for call-type messages (they have their own notifications)
            if (c.last_message.type === "call") return;

            // Don't notify if the conversation is open and tab is focused
            if (currentConversationId === c.id && document.hasFocus()) return;

            // Show browser notification
            showNotification(sender, c.last_message.text, c);

            // Play notification sound
            playNotificationSound();

            // Update page title with badge
            updateTitleBadge();
        } else {
            lastKnownMessages[key] = { timestamp: ts, sender };
        }
    });
}

function showNotification(sender, text, convo) {
    // Show in-app toast (works everywhere, no permissions needed)
    showToast(sender, text, convo);

    // Also try browser Notification API via Service Worker
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification(sender, {
                        body: text && text.length > 80 ? text.substring(0, 80) + "\u2026" : (text || "New message"),
                        icon: convo && convo.profile_pic ? convo.profile_pic : undefined,
                        tag: `msg-${convo ? convo.id : "unknown"}`,
                        data: { conversationId: convo ? convo.id : null, url: "/chat" },
                        vibrate: [100, 50, 100],
                        silent: false,
                    }).catch(() => {});
                });
            } else {
                const body = text && text.length > 80 ? text.substring(0, 80) + "\u2026" : (text || "New message");
                const notif = new Notification(sender, {
                    body: body,
                    icon: convo && convo.profile_pic ? convo.profile_pic : undefined,
                    tag: `msg-${convo ? convo.id : "unknown"}`,
                    silent: true,
                });
                notif.onclick = () => {
                    window.focus();
                    if (convo) openConversation(convo.id);
                    notif.close();
                };
                setTimeout(() => notif.close(), 5000);
            }
        } catch {}
    }

    // Vibrate on mobile
    if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
    }
}

// ==================
//  In-App Toast
// ==================
function showToast(sender, text, convo) {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "notification-toast";

    const initial = sender ? sender[0].toUpperCase() : "?";
    const avatarBg = convo ? (convo.avatar_color || "#6c63ff") : "#6c63ff";
    const avatarHtml = convo && convo.profile_pic
        ? `<img src="${convo.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
        : initial;

    const displayText = text && text.length > 60 ? text.substring(0, 60) + "\u2026" : (text || "New message");

    toast.innerHTML = `
        <div class="toast-avatar" style="background:${convo && convo.profile_pic ? 'transparent' : avatarBg}">${avatarHtml}</div>
        <div class="toast-body">
            <div class="toast-sender">${escapeHtml(sender)}</div>
            <div class="toast-text">${escapeHtml(displayText)}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    toast.addEventListener("click", (e) => {
        if (e.target.classList.contains("toast-close")) return;
        if (convo) openConversation(convo.id);
        toast.remove();
    });

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("visible"));

    setTimeout(() => {
        toast.classList.remove("visible");
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==================
//  Service Worker
// ==================
let swInitialized = false;

async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const sw = reg.active || reg.installing || reg.waiting;
        if (sw && sw.state === "activated") {
            initServiceWorker();
        } else if (sw) {
            sw.addEventListener("statechange", () => {
                if (sw.state === "activated") initServiceWorker();
            });
        }
        reg.addEventListener("updatefound", () => {
            const newSw = reg.installing;
            if (newSw) {
                newSw.addEventListener("statechange", () => {
                    if (newSw.state === "activated") initServiceWorker();
                });
            }
        });
    } catch (err) {
        console.warn("SW registration failed:", err);
    }
}

function initServiceWorker() {
    if (swInitialized) return;
    swInitialized = true;
}

function syncServiceWorker(convos) {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;

    if (!swInitialized) {
        swInitialized = true;
        navigator.serviceWorker.controller.postMessage({
            type: "init",
            username: window.CURRENT_USERNAME || "",
            conversations: convos.map(c => ({
                id: c.id,
                last_message: c.last_message,
            })),
        });
        navigator.serviceWorker.controller.postMessage({
            type: "visibility",
            visible: !document.hidden,
        });
        return;
    }

    navigator.serviceWorker.controller.postMessage({
        type: "update-conversations",
        conversations: convos.map(c => ({
            id: c.id,
            last_message: c.last_message,
        })),
    });
}

function playNotificationSound() {
    // Try HTML Audio element first (better mobile support)
    try {
        const audio = document.getElementById("notifSound");
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
            return;
        }
    } catch {}

    // Fallback to AudioContext
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;

        // First tone
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.value = 830;
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc1.connect(gain1).connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        // Second tone (slightly higher, slight delay)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.value = 1050;
        gain2.gain.setValueAtTime(0.12, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.3);

        setTimeout(() => ctx.close(), 500);
    } catch {}
}

function playCallRingtone() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        // Repeated ring pattern
        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = 440;
            gain.gain.setValueAtTime(0.12, now + i * 0.5);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.5 + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now + i * 0.5);
            osc.stop(now + i * 0.5 + 0.3);
        }
        setTimeout(() => ctx.close(), 2000);
    } catch {}
}

let titleBadgeCount = 0;
const originalTitle = document.title;

function updateTitleBadge() {
    titleBadgeCount++;
    document.title = `(${titleBadgeCount}) ${originalTitle}`;
}

// Clear badge when tab is focused
window.addEventListener("focus", () => {
    titleBadgeCount = 0;
    document.title = originalTitle;
});

// ==================
//  Back (mobile)
// ==================
function handleBack(e) {
    if (e) e.preventDefault();
    activeChat.classList.remove("visible");
    emptyState.style.display = "flex";
    sidebar.classList.remove("hidden");
    currentConversationId = null;
    stopTypingPolling();
    // Update URL state
    history.pushState({ view: "list" }, "", "/chat");
}

// ==================
//  Utilities
// ==================
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function getFileEmoji(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = { pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", ppt: "📊", pptx: "📊", zip: "📦", rar: "📦", "7z": "📦", txt: "📃", csv: "📃" };
    return map[ext] || "📎";
}

function stringToColor(str) {
    if (!str) return "#6c63ff";
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return `hsl(${Math.abs(hash) % 360}, 55%, 55%)`;
}

function debounce(fn, ms) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}


// ==========================================
//  ONLINE STATUS
// ==========================================

function sendHeartbeat() {
    fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
}

function updateChatStatus(convo) {
    if (!convo) { chatStatus.textContent = ""; return; }

    // If someone is typing, show that instead of normal status
    if (currentlyTyping.length > 0) {
        let typingText;
        if (currentlyTyping.length === 1) {
            typingText = convo.type === "direct" ? "typing" : `${currentlyTyping[0]} is typing`;
        } else if (currentlyTyping.length === 2) {
            typingText = `${currentlyTyping[0]} and ${currentlyTyping[1]} are typing`;
        } else {
            typingText = `${currentlyTyping.length} people are typing`;
        }
        chatStatus.innerHTML = `<span class="typing-indicator"><span class="typing-dots"><span></span><span></span><span></span></span> ${typingText}...</span>`;
        return;
    }

    if (convo.type === "direct") {
        if (convo._online) {
            chatStatus.innerHTML = `<span class="online-badge">● Online</span>`;
        } else if (convo._otherLastSeen) {
            chatStatus.innerHTML = `<span class="offline-badge">Last seen ${formatRelativeTime(convo._otherLastSeen)}</span>`;
        } else {
            chatStatus.textContent = "";
        }
    } else {
        chatStatus.textContent = `${convo.members ? convo.members.length : 0} members`;
    }
}

function formatRelativeTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}


// ==========================================
//  TYPING INDICATOR
// ==========================================

function sendTypingIndicator() {
    if (!currentConversationId) return;
    // Debounce: only send every 2 seconds
    if (typingTimeout) return;
    typingTimeout = setTimeout(() => { typingTimeout = null; }, 2000);
    fetch("/api/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: currentConversationId })
    }).catch(() => {});
}

function startTypingPolling(conversationId) {
    if (typingPollInterval) clearInterval(typingPollInterval);
    currentlyTyping = [];
    typingPollInterval = setInterval(async () => {
        if (currentConversationId !== conversationId) return;
        try {
            const res = await fetch(`/api/typing/${conversationId}`);
            const data = await res.json();
            const prev = JSON.stringify(currentlyTyping);
            currentlyTyping = data.typing || [];
            // Only update DOM if changed
            if (JSON.stringify(currentlyTyping) !== prev) {
                const convo = conversations.find(c => c.id === conversationId);
                updateChatStatus(convo);
            }
        } catch (e) { /* ignore */ }
    }, 1500);
}

function stopTypingPolling() {
    if (typingPollInterval) clearInterval(typingPollInterval);
    typingPollInterval = null;
    currentlyTyping = [];
}


// ==========================================
//  EMOJI PICKER
// ==========================================

const EMOJI_DATA = {
    "😀 Smileys": ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🫢","🫣","🤫","🤔","🫡","🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐","😕","🫤","😟","🙁","☹️","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱"],
    "👋 Gestures": ["👋","🤚","🖐️","✋","🖖","🫱","🫲","🫳","🫴","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","🫵","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🤝","🙏","💪","🦾","🦿","🦶","🦵","🫁","🫀","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
    "🐶 Animals": ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲","🪳","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🪸","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏"],
    "🍕 Food": ["🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🫛","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🫘","🥐","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍩","🍪","☕","🍵","🧋","🥤","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧃","🧊"],
    "⚽ Activities": ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤸","🤽","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🕹️","🧩"],
    "🚗 Travel": ["🚗","🚕","🚙","🏎️","🚌","🚎","🚐","🚑","🚒","🚓","🚔","🚖","🚘","🛻","🚚","🚛","🚜","🏍️","🛵","🛺","🚲","🛴","🛹","🛼","✈️","🛩️","🛫","🛬","🪂","💺","🚁","🛸","🚀","🛰️","⛵","🚤","🛥️","🛳️","⛴️","🚢","🏠","🏡","🏘️","🏗️","🏢","🏣","🏤","🏥","🏦","🏨","🏪","🏬","🏭","🏯","🏰","🗼","🗽","⛪","🕌","🛕","🕍","⛩️","🌁","🌃","🏙️","🌅","🌄","🌇","🌆","🌉","🎢","🎡","🎠","⛲","⛱️","🏖️","🏝️","🏜️","🌋","⛰️","🏔️","🗻","🏕️"],
    "💡 Objects": ["💡","🔦","🕯️","📱","💻","🖥️","🖨️","⌨️","🖱️","💽","💾","💿","📀","🧮","🎥","📸","📹","📼","🔍","🔎","🕵️","📡","📺","📻","🎙️","🎚️","📢","📣","📯","🔔","🔕","🎵","🎶","📝","📒","📕","📗","📘","📙","📓","📔","📚","📖","📰","📁","📂","✉️","📧","📩","📨","📬","📪","📫","📮","🗳️","✏️","✒️","🖊️","🖋️","📌","📍","📎","🖇️","📐","📏","🗑️","🔒","🔓","🔑","🗝️","🔧","🔩","⚙️","🧲","💊","🩹","🩺","💉","🔬","🔭","🧬","🧪"],
    "🏁 Symbols": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","❤️‍🔥","💯","💢","💥","💫","💦","💨","🕳️","💬","💭","🗯️","🔥","✨","🌟","💫","⭐","🌈","☀️","🌤️","⛅","🌥️","🌦️","🌧️","⛈️","🌩️","❄️","☃️","⛄","🌊","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","✅","❌","❓","❗","‼️","⁉️","⭕","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤","🏳️","🏴","🏁","🚩","🏳️‍🌈","🏳️‍⚧️"],
};

function initEmojiPicker() {
    const categories = Object.keys(EMOJI_DATA);
    // Render tabs
    emojiTabs.innerHTML = categories.map((cat, i) => {
        const icon = cat.split(" ")[0];
        return `<button class="emoji-tab ${i === 0 ? "active" : ""}" data-cat="${cat}" title="${cat}">${icon}</button>`;
    }).join("");

    // Tab click
    emojiTabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".emoji-tab");
        if (!tab) return;
        emojiTabs.querySelectorAll(".emoji-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderEmojiCategory(tab.dataset.cat);
    });

    // Search
    emojiSearch.addEventListener("input", () => {
        const q = emojiSearch.value.trim().toLowerCase();
        if (!q) { renderEmojiCategory(categories[0]); return; }
        const all = Object.values(EMOJI_DATA).flat();
        emojiGrid.innerHTML = all.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join("");
    });

    // Render first category
    renderEmojiCategory(categories[0]);
}

function renderEmojiCategory(cat) {
    const emojis = EMOJI_DATA[cat] || [];
    emojiGrid.innerHTML = emojis.map(e => `<span onclick="insertEmoji('${e}')">${e}</span>`).join("");
}

function insertEmoji(emoji) {
    const input = messageInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
}


// ==========================================
//  PROFILE / ABOUT / SETTINGS
// ==========================================

let cropImage = null;
let cropOffsetX = 0, cropOffsetY = 0;
let cropDragging = false;
let cropStartX = 0, cropStartY = 0;
let cropScale = 1;

async function openProfileModal() {
    try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        profileBio.value = data.bio || "";
        bioCharCount.textContent = profileBio.value.length;
        profileUsername.value = data.username || "";
        profileDisplayName.textContent = data.username || "";

        // Profile picture
        if (data.profile_pic) {
            profilePicImg.src = data.profile_pic;
            profilePicImg.style.display = "block";
            profileAvatar.style.display = "none";
            removePicBtn.style.display = "inline-block";
        } else {
            profilePicImg.style.display = "none";
            profileAvatar.style.display = "flex";
            removePicBtn.style.display = "none";
        }

        // Clear password fields
        currentPassword.value = "";
        newPassword.value = "";
        confirmPassword.value = "";

        profileModal.classList.add("visible");
    } catch {}
}

async function saveProfile() {
    let hasError = false;

    // Save bio
    try {
        await fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bio: profileBio.value.trim() }),
        });
    } catch { hasError = true; }

    // Change username if modified
    const newUsername = profileUsername.value.trim();
    if (newUsername && newUsername !== profileDisplayName.textContent) {
        try {
            const res = await fetch("/api/profile/username", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username: newUsername }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to change username");
                hasError = true;
            } else {
                profileDisplayName.textContent = newUsername;
                // Update sidebar current user display
                if (currentUserEl) {
                    const nameEl = currentUserEl.querySelector(".current-user-name");
                    if (nameEl) nameEl.textContent = newUsername;
                }
            }
        } catch { hasError = true; }
    }

    // Change password if fields filled
    if (currentPassword.value || newPassword.value || confirmPassword.value) {
        if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
            alert("Please fill all password fields");
            return;
        }
        try {
            const res = await fetch("/api/profile/password", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    current_password: currentPassword.value,
                    new_password: newPassword.value,
                    confirm_password: confirmPassword.value,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to change password");
                return;
            }
        } catch { hasError = true; }
    }

    if (!hasError) {
        profileModal.classList.remove("visible");
        loadConversations();
    }
}

// Profile picture upload
function handleProfilePicSelect() {
    profilePicInput.click();
}

function handleProfilePicChosen(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        alert("Please select an image file");
        return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
        openCropModal(ev.target.result);
    };
    reader.readAsDataURL(file);
    profilePicInput.value = "";
}

function openCropModal(imageSrc) {
    cropModal.style.display = "flex";
    cropImage = new Image();
    cropImage.onload = () => {
        cropScale = 1;
        cropZoom.value = 1;
        cropOffsetX = 0;
        cropOffsetY = 0;
        drawCrop();
    };
    cropImage.src = imageSrc;
}

function drawCrop() {
    if (!cropImage) return;
    const containerSize = 280;
    const ctx = cropCanvas.getContext("2d");
    cropCanvas.width = containerSize;
    cropCanvas.height = containerSize;

    // Scale image to fit, then apply zoom
    const scale = Math.max(containerSize / cropImage.width, containerSize / cropImage.height) * cropScale;
    const w = cropImage.width * scale;
    const h = cropImage.height * scale;

    // Center + offset
    const x = (containerSize - w) / 2 + cropOffsetX;
    const y = (containerSize - h) / 2 + cropOffsetY;

    ctx.clearRect(0, 0, containerSize, containerSize);
    ctx.drawImage(cropImage, x, y, w, h);
}

function handleCropZoom() {
    cropScale = parseFloat(cropZoom.value);
    drawCrop();
}

function handleCropMouseDown(e) {
    cropDragging = true;
    cropStartX = e.clientX - cropOffsetX;
    cropStartY = e.clientY - cropOffsetY;
}

function handleCropMouseMove(e) {
    if (!cropDragging) return;
    cropOffsetX = e.clientX - cropStartX;
    cropOffsetY = e.clientY - cropStartY;
    drawCrop();
}

function handleCropMouseUp() {
    cropDragging = false;
}

// Touch support for crop
function handleCropTouchStart(e) {
    const t = e.touches[0];
    cropDragging = true;
    cropStartX = t.clientX - cropOffsetX;
    cropStartY = t.clientY - cropOffsetY;
}

function handleCropTouchMove(e) {
    if (!cropDragging) return;
    e.preventDefault();
    const t = e.touches[0];
    cropOffsetX = t.clientX - cropStartX;
    cropOffsetY = t.clientY - cropStartY;
    drawCrop();
}

function handleCropTouchEnd() {
    cropDragging = false;
}

async function applyCrop() {
    if (!cropImage) return;

    // Extract the circular area as a square crop
    const outputSize = 256;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = outputSize;
    tempCanvas.height = outputSize;
    const ctx = tempCanvas.getContext("2d");

    // Calculate the crop region from the main canvas (center 240x240 of 280x280)
    const containerSize = 280;
    const circleSize = 240;
    const offset = (containerSize - circleSize) / 2;

    // Draw cropped region
    ctx.drawImage(cropCanvas, offset, offset, circleSize, circleSize, 0, 0, outputSize, outputSize);

    // Convert to blob and upload
    tempCanvas.toBlob(async (blob) => {
        if (!blob) return;

        const formData = new FormData();
        formData.append("picture", blob, "profile.jpg");

        try {
            const res = await fetch("/api/profile/picture", {
                method: "POST",
                body: formData,
            });
            const data = await res.json();
            if (res.ok && data.profile_pic) {
                profilePicImg.src = data.profile_pic + "?t=" + Date.now();
                profilePicImg.style.display = "block";
                profileAvatar.style.display = "none";
                removePicBtn.style.display = "inline-block";
                // Update sidebar avatar
                updateSidebarAvatar(data.profile_pic);
            } else {
                alert(data.error || "Failed to upload picture");
            }
        } catch {
            alert("Failed to upload picture");
        }

        cropModal.style.display = "none";
        cropImage = null;
    }, "image/jpeg", 0.85);
}

async function removeProfilePic() {
    if (!confirm("Remove your profile picture?")) return;
    try {
        const res = await fetch("/api/profile/picture", { method: "DELETE" });
        if (res.ok) {
            profilePicImg.style.display = "none";
            profileAvatar.style.display = "flex";
            removePicBtn.style.display = "none";
            updateSidebarAvatar("");
        }
    } catch {}
}

function updateSidebarAvatar(picUrl) {
    // Update the current user avatar in sidebar
    if (!currentUserEl) return;
    const avatarEl = currentUserEl.querySelector(".avatar");
    if (!avatarEl) return;
    if (picUrl) {
        avatarEl.innerHTML = `<img src="${picUrl}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        avatarEl.style.background = "transparent";
        avatarEl.style.overflow = "hidden";
    } else {
        const name = profileDisplayName.textContent || "?";
        avatarEl.innerHTML = name[0].toUpperCase();
        avatarEl.style.background = profileAvatar.style.background || "#6c63ff";
    }
    // also update the story add button avatar if present
    const myAvatar = document.getElementById("myStoryAvatar");
    if (myAvatar) {
        if (picUrl) {
            myAvatar.innerHTML = `<img src="${picUrl}?t=${Date.now()}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            myAvatar.style.background = "transparent";
            myAvatar.style.overflow = "hidden";
        } else {
            const name = profileDisplayName.textContent || "?";
            myAvatar.innerHTML = name[0].toUpperCase();
            myAvatar.style.background = profileAvatar.style.background || "#6c63ff";
        }
    }
    // Also refresh conversations to update everywhere
    loadConversations();
}


// ==========================================
//  STORIES
// ==========================================

let storyGroups = [];
let viewingGroupIdx = 0;
let viewingStoryIdx = 0;
let storyTimerHandle = null;
let selectedStoryBg = "#6c63ff";

async function loadStories() {
    try {
        const res = await fetch("/api/stories");
        storyGroups = await res.json();
        renderStoriesBar();
    } catch {}
}

function renderStoriesBar() {
    storiesList.innerHTML = storyGroups
        .filter(g => !g.is_mine)
        .map((g, i) => {
            // choose avatar content: profile_pic, or if first story is video show a muted looping preview,
            // otherwise fall back to initial letter.
            let avatarInner;
            if (g.profile_pic) {
                avatarInner = `<img src="${g.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
            } else if (g.stories && g.stories[0] && g.stories[0].content_type === "video" && g.stories[0].media_url) {
                avatarInner = `<video muted autoplay loop playsinline style="width:100%;height:100%;object-fit:cover;border-radius:50%"><source src="${g.stories[0].media_url}"></video>`;
            } else {
                const initial = g.username ? g.username[0].toUpperCase() : "?";
                avatarInner = initial;
            }

            return `
                <div class="story-item" onclick="openStoryViewer(${storyGroups.indexOf(g)})">
                    <div class="story-avatar-ring">
                        <div class="avatar story-av" style="background:${g.avatar_color}">${avatarInner}</div>
                    </div>
                    <span class="story-username">${escapeHtml(g.username)}</span>
                </div>`;
        }).join("");

    // Update "My Story" ring if I have stories
    const myGroup = storyGroups.find(g => g.is_mine);
    const ring = addStoryBtn.querySelector(".story-avatar-ring");
    if (myGroup && myGroup.stories.length > 0) {
        ring.classList.remove("add");
        ring.style.background = "linear-gradient(135deg, #6c63ff, #ec4899)";
        addStoryBtn.onclick = () => openStoryViewer(storyGroups.indexOf(myGroup));
    } else {
        ring.classList.add("add");
        ring.style.background = "";
        addStoryBtn.onclick = openStoryModal;
    }
}

function openStoryModal() {
    storyText.value = "";
    storyCaption.value = "";
    storyMediaPreview.innerHTML = `<button type="button" class="btn-secondary" id="selectStoryMedia">Choose Photo / Video</button>`;
    storyMediaInput.value = "";
    storyPrivacy.value = "everyone";
    storyCustomPicker.style.display = "none";
    storyUserSearch.value = "";
    storyCustomResults.innerHTML = "";
    customStoryUsers = [];
    renderSelectedStoryUsers();
    switchStoryTab("text");
    storyModal.classList.add("visible");
}

function switchStoryTab(type) {
    document.querySelectorAll(".story-type-tab").forEach(t => t.classList.toggle("active", t.dataset.type === type));
    storyTextSection.style.display = type === "text" ? "block" : "none";
    storyMediaSection.style.display = type === "media" ? "block" : "none";
}

let storyMediaDuration = 0;

function handleStoryMediaSelect() {
    const file = storyMediaInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("video")) {
        // preview with duration check
        const vid = document.createElement("video");
        vid.src = url;
        vid.controls = true;
        vid.style.maxWidth = "100%";
        vid.style.maxHeight = "200px";
        vid.style.borderRadius = "8px";
        vid.addEventListener("loadedmetadata", () => {
            storyMediaDuration = vid.duration;
            if (storyMediaDuration > 60) {
                alert("Video must be 60 seconds or shorter.");
                storyMediaInput.value = "";
                storyMediaPreview.innerHTML = `<button type=\"button\" class=\"btn-secondary\" id=\"selectStoryMedia\">Choose Photo / Video</button>`;
                storyMediaDuration = 0;
            }
        });
        storyMediaPreview.innerHTML = "";
        storyMediaPreview.appendChild(vid);
    } else {
        storyMediaDuration = 0;
        storyMediaPreview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:200px;border-radius:8px">`;
    }
}

async function postStory() {
    const isText = storyTextSection.style.display !== "none";
    const formData = new FormData();

    if (isText) {
        const text = storyText.value.trim();
        if (!text) { alert("Please write something."); return; }
        formData.append("content_type", "text");
        formData.append("text", text);
        const activeBg = bgColors.querySelector(".bg-color.active");
        formData.append("bg_color", activeBg ? activeBg.dataset.color : "#6c63ff");
    } else {
        const file = storyMediaInput.files[0];
        if (!file) { alert("Please select a photo or video."); return; }
        // if video but duration not yet known, load metadata first
        if (file.type.startsWith("video") && !storyMediaDuration) {
            await new Promise((resolve) => {
                const tmp = document.createElement("video");
                tmp.preload = "metadata";
                tmp.src = URL.createObjectURL(file);
                tmp.onloadedmetadata = () => {
                    storyMediaDuration = tmp.duration;
                    resolve();
                };
            });
        }
        // enforce max length again before posting
        if (file.type.startsWith("video") && storyMediaDuration > 60) {
            alert("Video must be 60 seconds or shorter.");
            return;
        }
        formData.append("content_type", file.type.startsWith("video") ? "video" : "image");
        formData.append("media", file);
        formData.append("text", storyCaption.value.trim());
        if (file.type.startsWith("video") && storyMediaDuration) {
            formData.append("duration", storyMediaDuration);
        }
    }
    formData.append("privacy", storyPrivacy.value);

    if (storyPrivacy.value === "custom") {
        if (customStoryUsers.length === 0) {
            alert("Please select at least one person for custom privacy.");
            return;
        }
        formData.append("allowed_users", customStoryUsers.map(u => u.id).join(","));
    }

    try {
        postStoryBtn.textContent = "Posting…";
        postStoryBtn.disabled = true;
        await fetch("/api/stories", { method: "POST", body: formData });
        storyModal.classList.remove("visible");
        await loadStories();
    } catch (err) {
        alert("Failed to post story.");
    } finally {
        postStoryBtn.textContent = "Post Story";
        postStoryBtn.disabled = false;
    }
}

// ==========================================
//  STORY CUSTOM USER PICKER
// ==========================================

let customStoryUsers = [];

async function handleStoryUserSearch() {
    const q = storyUserSearch.value.trim();
    if (!q) { storyCustomResults.innerHTML = ""; return; }
    try {
        const res = await fetch(`/api/search/users?q=${encodeURIComponent(q)}`);
        const users = await res.json();
        const selectedIds = customStoryUsers.map(u => u.id);
        const filtered = users.filter(u => !selectedIds.includes(u.id));
        storyCustomResults.innerHTML = filtered.length === 0
            ? `<div style="padding:8px;text-align:center;color:#6b7280;font-size:0.8rem;">No users found</div>`
            : filtered.map(u => {
                const pic = u.profile_pic
                    ? `<div class="avatar" style="overflow:hidden;background:transparent"><img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                    : `<div class="avatar" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>`;
                return `<div class="custom-user-item" data-id="${u.id}" data-username="${escapeHtml(u.username)}" data-color="${u.avatar_color}" onclick="addCustomStoryUser(this)">
                    ${pic}
                    <span>${escapeHtml(u.username)}</span>
                </div>`;
            }).join("");
    } catch {
        storyCustomResults.innerHTML = "";
    }
}

function addCustomStoryUser(el) {
    const id = el.dataset.id;
    const username = el.dataset.username;
    if (customStoryUsers.find(u => u.id === id)) return;
    customStoryUsers.push({ id, username });
    renderSelectedStoryUsers();
    storyUserSearch.value = "";
    storyCustomResults.innerHTML = "";
    storyUserSearch.focus();
}

function removeCustomStoryUser(id) {
    customStoryUsers = customStoryUsers.filter(u => u.id !== id);
    renderSelectedStoryUsers();
}

function renderSelectedStoryUsers() {
    storySelectedUsers.innerHTML = customStoryUsers.map(u =>
        `<span class="story-selected-chip">
            ${escapeHtml(u.username)}
            <span class="chip-remove" onclick="removeCustomStoryUser('${u.id}')">&times;</span>
        </span>`
    ).join("");
}

function openStoryViewer(groupIdx) {
    if (groupIdx < 0 || groupIdx >= storyGroups.length) return;
    viewingGroupIdx = groupIdx;
    viewingStoryIdx = 0;
    storyViewer.classList.add("visible");
    showCurrentStory();
}

function showCurrentStory() {
    const group = storyGroups[viewingGroupIdx];
    if (!group) { closeStoryViewerFn(); return; }
    const stories = group.stories;
    if (viewingStoryIdx >= stories.length) {
        // Move to next group
        if (viewingGroupIdx < storyGroups.length - 1) {
            viewingGroupIdx++;
            viewingStoryIdx = 0;
            showCurrentStory();
        } else {
            closeStoryViewerFn();
        }
        return;
    }

    const story = stories[viewingStoryIdx];

    storyViewerAvatar.textContent = group.username[0].toUpperCase();
    storyViewerAvatar.style.background = group.avatar_color;
    storyViewerName.textContent = group.username;
    storyViewerTime.textContent = formatRelativeTime(story.created_at);

    // Progress bar
    storyProgressBar.innerHTML = stories.map((s, i) => {
        const cls = i < viewingStoryIdx ? "done" : (i === viewingStoryIdx ? "active" : "");
        return `<div class="story-progress-seg ${cls}"><div class="fill"></div></div>`;
    }).join("");

    // Content
    if (story.content_type === "text") {
        storyViewerContent.innerHTML = `<div class="story-text-display" style="background:${story.bg_color}">${escapeHtml(story.text)}</div>`;
        // static 5s timer already set below
    } else if (story.content_type === "video") {
        storyViewerContent.innerHTML = "";
        const vid = document.createElement("video");
        vid.src = story.media_url;
        vid.autoplay = true;
        vid.playsInline = true;
        vid.style.maxWidth = "100%";
        vid.style.maxHeight = "100%";
        storyViewerContent.appendChild(vid);

        // when metadata loads, schedule advance and animate progress
        vid.addEventListener("loadedmetadata", () => {
            const dur = Math.min(vid.duration || story.duration || 0, 60) || 5;
            // adjust active bar
            const activeSeg = storyProgressBar.querySelector(".story-progress-seg.active .fill");
            if (activeSeg) activeSeg.style.animationDuration = dur + "s";
            clearTimeout(storyTimerHandle);
            storyTimerHandle = setTimeout(() => {
                viewingStoryIdx++;
                showCurrentStory();
            }, dur * 1000);
        });

        vid.addEventListener("ended", () => {
            viewingStoryIdx++;
            showCurrentStory();
        });
    } else {
        storyViewerContent.innerHTML = `<img src="${story.media_url}" style="max-width:100%;max-height:100%;object-fit:contain">`;
        if (story.text) {
            storyViewerContent.innerHTML += `<div style="position:absolute;bottom:60px;left:0;right:0;text-align:center;color:#fff;font-size:1rem;text-shadow:0 1px 4px rgba(0,0,0,0.6);padding:10px">${escapeHtml(story.text)}</div>`;
        }
    }

    // Mark as viewed
    fetch(`/api/stories/${story.id}/view`, { method: "POST" }).catch(() => {});

    // Show delete button only for own stories
    const deleteBtn = document.getElementById("deleteStoryBtn");
    deleteBtn.style.display = story.is_mine ? "flex" : "none";
    deleteBtn.onclick = () => deleteCurrentStory(story.id);

    // Auto-advance fallback (text or if metadata hasn't fired yet)
    if (story.content_type !== "video") {
        clearTimeout(storyTimerHandle);
        storyTimerHandle = setTimeout(() => {
            viewingStoryIdx++;
            showCurrentStory();
        }, 5000);
    }
}

function navigateStory(dir) {
    clearTimeout(storyTimerHandle);
    viewingStoryIdx += dir;
    const group = storyGroups[viewingGroupIdx];
    if (!group) { closeStoryViewerFn(); return; }
    if (viewingStoryIdx < 0) {
        if (viewingGroupIdx > 0) {
            viewingGroupIdx--;
            viewingStoryIdx = storyGroups[viewingGroupIdx].stories.length - 1;
        } else {
            viewingStoryIdx = 0;
        }
    }
    showCurrentStory();
}

function closeStoryViewerFn() {
    clearTimeout(storyTimerHandle);
    // stop any video that's playing
    const vid = storyViewerContent.querySelector("video");
    if (vid && !vid.paused) {
        vid.pause();
        vid.src = "";
    }
    storyViewer.classList.remove("visible");
}

async function deleteCurrentStory(storyId) {
    if (!confirm("Delete this story?")) return;
    clearTimeout(storyTimerHandle);
    try {
        await fetch(`/api/stories/${storyId}`, { method: "DELETE" });
        await loadStories();
        // If there are more stories in this group, show next; otherwise close
        const group = storyGroups[viewingGroupIdx];
        if (group && group.stories.length > 0) {
            if (viewingStoryIdx >= group.stories.length) viewingStoryIdx = group.stories.length - 1;
            showCurrentStory();
        } else {
            closeStoryViewerFn();
        }
    } catch {
        alert("Failed to delete story.");
    }
}


// ==========================================
//  VOICE & VIDEO CALL (WebRTC)
// ==========================================

const ICE_SERVERS = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
    ]
};

let pendingIncomingCall = null; // store incoming call data

// ---------- Get target user id for current conversation ----------
function getTargetUserId() {
    const convo = conversations.find(c => c.id === currentConversationId);
    if (!convo || convo.type !== "direct" || convo.members.length < 2) return null;
    // We need to figure out which member is NOT us — we'll fetch from API
    return convo._targetId || null;
}

async function resolveTargetUserId() {
    try {
        const res = await fetch("/api/users");
        const users = await res.json();
        const me = users.find(u => u.is_me);
        const convo = conversations.find(c => c.id === currentConversationId);
        if (!convo) return null;
        const otherId = convo.members.find(id => id !== me.id);
        return otherId;
    } catch { return null; }
}

// ---------- Initiate a call ----------
async function initiateCall(callType) {
    if (!currentConversationId) return;
    if (currentCallId) { alert("Already in a call"); return; }

    const targetId = await resolveTargetUserId();
    if (!targetId) { alert("Can only call in direct conversations."); return; }

    const convo = conversations.find(c => c.id === currentConversationId);

    // Track call type on the conversation for later recording
    if (convo) convo._lastCallType = callType;

    try {
        // Get local media
        const constraints = {
            audio: true,
            video: callType === "video" ? { width: 640, height: 480 } : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        // Show active call UI
        showActiveCallUI(convo ? convo.name : "Call", callType);
        localVideo.srcObject = localStream;
        callTimerEl.textContent = "Ringing…";

        // Create peer connection
        peerConnection = new RTCPeerConnection(ICE_SERVERS);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        peerConnection.ontrack = (e) => {
            const stream = e.streams[0];
            if (isSpeakerOn) {
                // Loudspeaker: play through <video>
                remoteVideo.srcObject = stream;
                remoteVideo.muted = false;
                remoteAudio.srcObject = null;
            } else {
                // Earpiece: play audio through <audio>, video (if any) muted on <video>
                remoteAudio.srcObject = stream;
                remoteAudio.play().catch(() => {});
                if (stream.getVideoTracks().length > 0) {
                    remoteVideo.srcObject = stream;
                    remoteVideo.muted = true;
                } else {
                    remoteVideo.srcObject = stream;
                }
            }
        };

        // Collect ICE candidates
        const iceCandidates = [];
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) iceCandidates.push(e.candidate);
        };

        // Create and set offer
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Wait a moment for ICE gathering
        await new Promise(r => setTimeout(r, 1000));

        // Send offer to signaling server
        const res = await fetch("/api/call/initiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                target_id: targetId,
                call_type: callType,
                offer: JSON.stringify(peerConnection.localDescription),
            }),
        });
        const data = await res.json();
        currentCallId = data.call_id;

        // Send collected ICE candidates
        for (const c of iceCandidates) {
            await fetch(`/api/call/${currentCallId}/ice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidate: JSON.stringify(c) }),
            });
        }

        // Continue collecting ICE
        peerConnection.onicecandidate = async (e) => {
            if (e.candidate && currentCallId) {
                await fetch(`/api/call/${currentCallId}/ice`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ candidate: JSON.stringify(e.candidate) }),
                });
            }
        };

        // Poll for answer
        pollForAnswer();

    } catch (err) {
        console.error("Call initiation failed:", err);
        alert("Could not start call. Check microphone/camera permissions.");
        cleanupCall();
    }
}

// ---------- Poll for answer (caller side) ----------
function pollForAnswer() {
    const pollId = currentCallId;
    const interval = setInterval(async () => {
        if (currentCallId !== pollId) { clearInterval(interval); return; }
        try {
            const res = await fetch(`/api/call/${pollId}/answer-check`);
            const data = await res.json();

            if (data.status === "ended") {
                clearInterval(interval);
                cleanupCall();
                return;
            }

            if (data.status === "answered" && data.answer) {
                clearInterval(interval);
                const answer = JSON.parse(data.answer);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

                // Add remote ICE candidates
                if (data.ice_candidates) {
                    for (const c of data.ice_candidates) {
                        try {
                            await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(c)));
                        } catch {}
                    }
                }

                startCallTimer();
                startICEPolling();
            }
        } catch {}
    }, 1500);
}

// ---------- Check incoming calls ----------
async function checkIncomingCall() {
    if (currentCallId) return; // already in a call
    try {
        const res = await fetch("/api/call/check");
        const data = await res.json();
        if (data.call_id) {
            pendingIncomingCall = data;
            showIncomingCallUI(data);
        }
    } catch {}
}

function showIncomingCallUI(data) {
    incomingAvatar.textContent = data.caller_name ? data.caller_name[0].toUpperCase() : "?";
    incomingAvatar.style.background = data.caller_color || "#6c63ff";
    incomingName.textContent = data.caller_name;
    incomingLabel.textContent = data.call_type === "video" ? "Incoming video call…" : "Incoming voice call…";
    incomingCallOverlay.classList.add("visible");

    // Play ring sound
    playCallRingtone();

    // Show browser notification for incoming call
    if ("Notification" in window && Notification.permission === "granted" && !document.hasFocus()) {
        const callNotif = new Notification(`${data.caller_name}`, {
            body: data.call_type === "video" ? "📹 Incoming video call…" : "📞 Incoming voice call…",
            tag: "incoming-call",
            requireInteraction: true,
        });
        callNotif.onclick = () => {
            window.focus();
            callNotif.close();
        };
        setTimeout(() => callNotif.close(), 5000);
    }
}

// ---------- Accept call ----------
async function acceptCall() {
    if (!pendingIncomingCall) return;
    const data = pendingIncomingCall;
    currentCallId = data.call_id;
    incomingCallOverlay.classList.remove("visible");

    try {
        const constraints = {
            audio: true,
            video: data.call_type === "video" ? { width: 640, height: 480 } : false
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        showActiveCallUI(data.caller_name, data.call_type);
        localVideo.srcObject = localStream;
        callTimerEl.textContent = "Connecting…";

        peerConnection = new RTCPeerConnection(ICE_SERVERS);
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));

        peerConnection.ontrack = (e) => {
            const stream = e.streams[0];
            if (isSpeakerOn) {
                // Loudspeaker: play through <video>
                remoteVideo.srcObject = stream;
                remoteVideo.muted = false;
                remoteAudio.srcObject = null;
            } else {
                // Earpiece: play audio through <audio>, video (if any) muted on <video>
                remoteAudio.srcObject = stream;
                remoteAudio.play().catch(() => {});
                if (stream.getVideoTracks().length > 0) {
                    remoteVideo.srcObject = stream;
                    remoteVideo.muted = true;
                } else {
                    remoteVideo.srcObject = stream;
                }
            }
        };

        // Set remote offer
        const offer = JSON.parse(data.offer);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        // Collect ICE candidates
        const iceCandidates = [];
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) iceCandidates.push(e.candidate);
        };

        // Create answer
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        await new Promise(r => setTimeout(r, 1000));

        // Send answer
        await fetch(`/api/call/${currentCallId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: JSON.stringify(peerConnection.localDescription) }),
        });

        // Send ICE candidates
        for (const c of iceCandidates) {
            await fetch(`/api/call/${currentCallId}/ice`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidate: JSON.stringify(c) }),
            });
        }

        peerConnection.onicecandidate = async (e) => {
            if (e.candidate && currentCallId) {
                await fetch(`/api/call/${currentCallId}/ice`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ candidate: JSON.stringify(e.candidate) }),
                });
            }
        };

        startCallTimer();
        startICEPolling();

    } catch (err) {
        console.error("Accept call failed:", err);
        alert("Could not accept call. Check microphone/camera permissions.");
        cleanupCall();
    }
    pendingIncomingCall = null;
}

// ---------- Reject call ----------
async function rejectCall() {
    if (!pendingIncomingCall) return;
    const callConvoId = currentConversationId;
    const callType = pendingIncomingCall.call_type || "voice";

    try {
        await fetch(`/api/call/${pendingIncomingCall.call_id}/end`, { method: "POST" });
    } catch {}
    pendingIncomingCall = null;
    incomingCallOverlay.classList.remove("visible");

    // Find the conversation for this caller and post a "rejected" call record
    // The caller's conversation will get the record from their end
}

// ---------- End call ----------
async function endCall() {
    const callDuration = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const callConvoId = currentConversationId;
    const wasAnswered = callStartTime > 0;

    if (currentCallId) {
        try {
            await fetch(`/api/call/${currentCallId}/end`, { method: "POST" });
        } catch {}
    }
    cleanupCall();

    // Post call record to chat
    if (callConvoId) {
        const convo = conversations.find(c => c.id === callConvoId);
        const callType = convo && convo._lastCallType || "voice";
        await postCallRecord(callConvoId, callType, wasAnswered ? "ended" : "missed", callDuration);
    }
}

// ---------- Toggle mute ----------
function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    toggleMuteBtn.classList.toggle("muted", isMuted);
}

// ---------- Toggle speaker / loudspeaker ----------
// On mobile, audio played through <audio> goes to earpiece,
// while audio through <video> goes to the loudspeaker.
// We swap the remote stream between these elements to toggle.
function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    toggleSpeakerBtn.classList.toggle("active-speaker", isSpeakerOn);

    const remoteStream = remoteVideo.srcObject || remoteAudio.srcObject;
    if (!remoteStream) return;

    if (isSpeakerOn) {
        // Route to loudspeaker: play through <video> element
        remoteAudio.srcObject = null;
        remoteAudio.pause();
        remoteVideo.srcObject = remoteStream;
        remoteVideo.play().catch(() => {});
        remoteVideo.muted = false;
    } else {
        // Route to earpiece: play through hidden <audio> element
        remoteVideo.srcObject = null;
        remoteAudio.srcObject = remoteStream;
        remoteAudio.play().catch(() => {});
        // Keep video element showing the video track if it's a video call
        // but mute its audio so we don't double-play
        const videoTracks = remoteStream.getVideoTracks();
        if (videoTracks.length > 0) {
            remoteVideo.srcObject = remoteStream;
            remoteVideo.muted = true;
        }
    }

    // Also try setSinkId for desktop browsers that support it
    if (typeof remoteVideo.setSinkId === "function") {
        navigator.mediaDevices.enumerateDevices().then(devices => {
            const outputs = devices.filter(d => d.kind === "audiooutput");
            if (isSpeakerOn && outputs.length > 1) {
                const speaker = outputs.find(d => /speaker/i.test(d.label)) || outputs[outputs.length - 1];
                remoteVideo.setSinkId(speaker.deviceId).catch(() => {});
                remoteAudio.setSinkId(speaker.deviceId).catch(() => {});
            } else {
                remoteVideo.setSinkId("default").catch(() => {});
                remoteAudio.setSinkId("default").catch(() => {});
            }
        }).catch(() => {});
    }
}

// ---------- Post call record to chat ----------
async function postCallRecord(conversationId, callType, callStatus, duration) {
    const labels = {
        voice: { ended: "Voice call", missed: "Missed voice call", rejected: "Call declined" },
        video: { ended: "Video call", missed: "Missed video call", rejected: "Call declined" },
    };
    const text = (labels[callType] || labels.voice)[callStatus] || "Call";

    try {
        await fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversation_id: conversationId,
                type: "call",
                text: text,
                call_type: callType,
                call_status: callStatus,
                call_duration: duration || 0,
            }),
        });
        if (currentConversationId === conversationId) {
            await loadMessages(conversationId);
        }
        loadConversations();
    } catch (err) {
        console.error("Failed to post call record:", err);
    }
}

// ---------- Toggle camera ----------
function toggleCamera() {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    isCameraOff = !isCameraOff;
    videoTracks.forEach(t => t.enabled = !isCameraOff);
    toggleCameraBtn.classList.toggle("muted", isCameraOff);
}

// ---------- Switch camera (front / rear) ----------
async function switchCamera() {
    if (!localStream || !peerConnection) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;

    // Toggle facing mode
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";

    try {
        // Get new video track with the other camera
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: 640, height: 480 }
        });
        const newTrack = newStream.getVideoTracks()[0];

        // Replace the track on the peer connection sender
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) {
            await sender.replaceTrack(newTrack);
        }

        // Stop old video track and swap in new one
        videoTracks.forEach(t => t.stop());
        localStream.removeTrack(videoTracks[0]);
        localStream.addTrack(newTrack);

        // Update local preview
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error("Failed to switch camera:", err);
        // Revert facing mode on failure
        currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    }
}

// ---------- ICE polling (exchange candidates during call) ----------
function startICEPolling() {
    let addedCount = 0;
    icePollInterval = setInterval(async () => {
        if (!currentCallId) { clearInterval(icePollInterval); return; }
        try {
            const res = await fetch(`/api/call/${currentCallId}/ice-poll`);
            const data = await res.json();

            if (data.status === "ended") {
                clearInterval(icePollInterval);
                cleanupCall();
                return;
            }

            const candidates = data.candidates || [];
            for (let i = addedCount; i < candidates.length; i++) {
                try {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidates[i])));
                } catch {}
            }
            addedCount = candidates.length;
        } catch {}
    }, 2000);
}

// ---------- Call timer ----------
function startCallTimer() {
    callStartTime = Date.now();
    callTimerEl.textContent = "0:00";
    callTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = elapsed % 60;
        callTimerEl.textContent = `${m}:${s.toString().padStart(2, "0")}`;
    }, 500);
}

// ---------- UI Helpers ----------
function showActiveCallUI(name, callType) {
    activeCallAvatar.textContent = name ? name[0].toUpperCase() : "?";
    activeCallName.textContent = name || "Call";
    activeCallOverlay.classList.add("visible");

    // Show/hide video elements based on call type
    const showVideo = callType === "video";
    document.querySelector(".call-remote-video-wrapper").style.display = showVideo ? "block" : "none";
    document.querySelector(".call-local-video-wrapper").style.display = showVideo ? "block" : "none";
    document.querySelector(".call-screen-info").style.display = showVideo ? "none" : "flex";
    toggleCameraBtn.style.display = showVideo ? "flex" : "none";
    switchCameraBtn.style.display = showVideo ? "flex" : "none";
}

function cleanupCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remoteVideo.muted = false;
    remoteAudio.srcObject = null;
    remoteAudio.pause();
    currentCallId = null;
    isMuted = false;
    isCameraOff = false;
    currentFacingMode = "user";
    isSpeakerOn = false;
    toggleMuteBtn.classList.remove("muted");
    toggleSpeakerBtn.classList.remove("active-speaker");
    toggleCameraBtn.classList.remove("muted");
    switchCameraBtn.style.display = "none";

    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    if (icePollInterval) { clearInterval(icePollInterval); icePollInterval = null; }

    activeCallOverlay.classList.remove("visible");
    incomingCallOverlay.classList.remove("visible");
}


// =============================================
//  GROUP INFO PANEL
// =============================================
let groupInfoData = null;   // Cached group info
let giBackdropEl = null;    // Backdrop element

function getOrCreateBackdrop() {
    if (!giBackdropEl) {
        giBackdropEl = document.createElement("div");
        giBackdropEl.className = "gi-backdrop";
        giBackdropEl.onclick = closeGroupInfo;
        document.body.appendChild(giBackdropEl);
    }
    return giBackdropEl;
}

async function openGroupInfo() {
    if (!currentConversationId) return;
    const convo = conversations.find(c => c.id === currentConversationId);
    if (!convo || convo.type !== "group") return;

    const panel = document.getElementById("groupInfoPanel");
    const backdrop = getOrCreateBackdrop();

    try {
        const res = await fetch(`/api/groups/${currentConversationId}/info`);
        if (!res.ok) { console.error("Failed to load group info"); return; }
        groupInfoData = await res.json();
    } catch (err) { console.error("Error loading group info:", err); return; }

    renderGroupInfo();
    panel.classList.add("open");
    backdrop.classList.add("open");
}

function closeGroupInfo() {
    const panel = document.getElementById("groupInfoPanel");
    const backdrop = getOrCreateBackdrop();
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    groupInfoData = null;
    // Clear add-member search
    const addSearch = document.getElementById("giAddSearch");
    if (addSearch) addSearch.value = "";
    const addResults = document.getElementById("giAddResults");
    if (addResults) addResults.innerHTML = "";
}

function renderGroupInfo() {
    if (!groupInfoData) return;
    const d = groupInfoData;
    const isAdmin = d.is_admin;

    // Group picture
    const picAvatar = document.getElementById("giPicAvatar");
    const picImg = document.getElementById("giPicImg");
    const picOverlay = document.getElementById("giPicOverlay");
    const picActions = document.getElementById("giPicActions");
    const removePicBtn = document.getElementById("giRemovePicBtn");

    picAvatar.style.background = d.color || "#6c63ff";
    if (d.group_pic) {
        picImg.src = d.group_pic;
        picImg.style.display = "";
        picAvatar.querySelector("svg").style.display = "none";
    } else {
        picImg.style.display = "none";
        picAvatar.querySelector("svg").style.display = "";
    }

    if (isAdmin) {
        picOverlay.style.display = "";
        picActions.style.display = "";
        removePicBtn.style.display = d.group_pic ? "" : "none";
        // Click to upload
        document.getElementById("giPicWrapper").onclick = () => document.getElementById("groupPicInput").click();
    } else {
        picOverlay.style.display = "none";
        picActions.style.display = "none";
        document.getElementById("giPicWrapper").onclick = null;
    }

    // Name & description
    document.getElementById("giName").textContent = d.name;
    const descEl = document.getElementById("giDesc");
    descEl.textContent = d.description || "";
    descEl.style.display = d.description ? "" : "none";

    // Edit button (admin only)
    document.getElementById("giEditBtn").style.display = isAdmin ? "" : "none";
    document.getElementById("giEditForm").style.display = "none";

    // Meta
    const createdAt = d.created_at ? new Date(d.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    document.getElementById("giCreatedAt").textContent = createdAt ? `Created ${createdAt}` : "";
    document.getElementById("giMemberCount").textContent = `${d.member_count} member${d.member_count !== 1 ? "s" : ""}`;

    // Add member section (admin only)
    document.getElementById("giAddMember").style.display = isAdmin ? "" : "none";

    // Members title
    document.getElementById("giMembersTitle").textContent = `Members (${d.member_count})`;

    // Members list
    const myName = window.CURRENT_USERNAME;
    const membersList = document.getElementById("giMembersList");
    membersList.innerHTML = d.members.map(m => {
        const isMe = m.username === myName;
        const avatarHtml = m.profile_pic
            ? `<div class="avatar" style="overflow:hidden;background:transparent"><img src="${m.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
            : `<div class="avatar" style="background:${m.avatar_color}">${m.username[0].toUpperCase()}</div>`;

        let roleBadge = "";
        if (m.is_creator) roleBadge = `<span class="gi-role-badge creator">Creator</span>`;
        else if (m.is_admin) roleBadge = `<span class="gi-role-badge admin">Admin</span>`;

        const youBadge = isMe ? `<span class="you-badge">(You)</span>` : "";

        const statusHtml = m.online
            ? `<div class="gi-member-status online">Online</div>`
            : `<div class="gi-member-status">Offline</div>`;

        // Action buttons: only shown to admins, not for self, not for creator
        let actionsHtml = "";
        if (isAdmin && !isMe && !m.is_creator) {
            let btns = "";
            if (m.is_admin) {
                btns += `<button class="gi-action-btn remove-admin" onclick="removeAdminRole('${m.id}')" title="Remove admin">Demote</button>`;
            } else {
                btns += `<button class="gi-action-btn make-admin" onclick="makeAdmin('${m.id}')" title="Make admin">Admin</button>`;
            }
            btns += `<button class="gi-action-btn remove-member" onclick="removeMember('${m.id}', '${escapeHtml(m.username)}')" title="Remove from group">Remove</button>`;
            actionsHtml = `<div class="gi-member-actions">${btns}</div>`;
        }

        return `
            <div class="gi-member-item">
                ${avatarHtml}
                <div class="gi-member-info">
                    <div class="gi-member-name">${escapeHtml(m.username)} ${youBadge} ${roleBadge}</div>
                    ${statusHtml}
                </div>
                ${actionsHtml}
            </div>`;
    }).join("");
}

// --- Group picture upload ---
document.getElementById("groupPicInput").addEventListener("change", async function() {
    const file = this.files[0];
    if (!file || !groupInfoData) return;

    const formData = new FormData();
    formData.append("picture", file);

    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/picture`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            showActionToast("Group photo updated");
            await refreshGroupInfo();
            loadConversations();
        } else {
            showActionToast(data.error || "Failed to upload");
        }
    } catch (err) { console.error(err); showActionToast("Upload failed"); }
    this.value = "";
});

function uploadGroupPic() {
    document.getElementById("groupPicInput").click();
}

async function removeGroupPic() {
    if (!groupInfoData) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/picture`, { method: "DELETE" });
        if (res.ok) {
            showActionToast("Group photo removed");
            await refreshGroupInfo();
            loadConversations();
        }
    } catch (err) { console.error(err); }
}

// --- Edit group name/description ---
function openGroupEditForm() {
    if (!groupInfoData) return;
    document.getElementById("giEditName").value = groupInfoData.name;
    document.getElementById("giEditDesc").value = groupInfoData.description || "";
    document.getElementById("giEditForm").style.display = "";
    document.getElementById("giEditBtn").style.display = "none";
    document.getElementById("giName").style.display = "none";
    document.getElementById("giDesc").style.display = "none";
    document.getElementById("giEditName").focus();
}

function cancelGroupEdit() {
    document.getElementById("giEditForm").style.display = "none";
    document.getElementById("giEditBtn").style.display = "";
    document.getElementById("giName").style.display = "";
    const descEl = document.getElementById("giDesc");
    descEl.style.display = groupInfoData && groupInfoData.description ? "" : "none";
}

async function saveGroupEdit() {
    if (!groupInfoData) return;
    const name = document.getElementById("giEditName").value.trim();
    const desc = document.getElementById("giEditDesc").value.trim();
    if (!name) { document.getElementById("giEditName").focus(); return; }

    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/update`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, description: desc })
        });
        if (res.ok) {
            showActionToast("Group info updated");
            cancelGroupEdit();
            await refreshGroupInfo();
            loadConversations();
            // Also update chat header
            chatName.textContent = name;
        } else {
            const data = await res.json();
            showActionToast(data.error || "Update failed");
        }
    } catch (err) { console.error(err); showActionToast("Update failed"); }
}

// --- Add member ---
async function handleGroupAddSearch() {
    const query = document.getElementById("giAddSearch").value.trim();
    const resultsEl = document.getElementById("giAddResults");
    if (query.length < 1) { resultsEl.innerHTML = ""; return; }
    if (!groupInfoData) return;

    try {
        const res = await fetch(`/api/search/users?q=${encodeURIComponent(query)}`);
        const users = await res.json();
        // Filter out existing members
        const existingIds = groupInfoData.members.map(m => m.id);
        const available = users.filter(u => !existingIds.includes(u.id));

        resultsEl.innerHTML = available.length === 0
            ? `<div style="padding:10px;text-align:center;color:#6b7280;font-size:0.82rem;">No users found</div>`
            : available.map(u => `
                <div class="gi-add-item">
                    ${u.profile_pic
                        ? `<div class="avatar" style="overflow:hidden;background:transparent"><img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                        : `<div class="avatar" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>`}
                    <span class="username">${escapeHtml(u.username)}</span>
                    <button class="btn-small btn-primary" onclick="addMemberToGroup('${u.id}')">Add</button>
                </div>`).join("");
    } catch (err) { console.error(err); }
}

async function addMemberToGroup(userId) {
    if (!groupInfoData) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_id: userId })
        });
        const data = await res.json();
        if (res.ok) {
            showActionToast(`${data.username} added to group`);
            document.getElementById("giAddSearch").value = "";
            document.getElementById("giAddResults").innerHTML = "";
            await refreshGroupInfo();
            loadConversations();
        } else {
            showActionToast(data.error || "Failed to add member");
        }
    } catch (err) { console.error(err); showActionToast("Failed to add member"); }
}

// --- Remove member ---
async function removeMember(memberId, username) {
    if (!groupInfoData) return;
    if (!confirm(`Remove ${username} from this group?`)) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/members/${memberId}`, { method: "DELETE" });
        if (res.ok) {
            showActionToast(`${username} removed`);
            await refreshGroupInfo();
            loadConversations();
        } else {
            const data = await res.json();
            showActionToast(data.error || "Failed to remove");
        }
    } catch (err) { console.error(err); showActionToast("Failed to remove member"); }
}

// --- Make admin / Remove admin ---
async function makeAdmin(memberId) {
    if (!groupInfoData) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/admins`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member_id: memberId })
        });
        if (res.ok) {
            showActionToast("Admin role granted");
            await refreshGroupInfo();
        } else {
            const data = await res.json();
            showActionToast(data.error || "Failed");
        }
    } catch (err) { console.error(err); }
}

async function removeAdminRole(memberId) {
    if (!groupInfoData) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/admins/${memberId}`, { method: "DELETE" });
        if (res.ok) {
            showActionToast("Admin role removed");
            await refreshGroupInfo();
        } else {
            const data = await res.json();
            showActionToast(data.error || "Failed");
        }
    } catch (err) { console.error(err); }
}

// --- Leave group ---
async function leaveGroup() {
    if (!groupInfoData) return;
    if (!confirm("Are you sure you want to leave this group?")) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/leave`, { method: "POST" });
        if (res.ok) {
            closeGroupInfo();
            currentConversationId = null;
            emptyState.style.display = "";
            activeChat.classList.remove("visible");
            showActionToast("You left the group");
            await loadConversations();
        } else {
            const data = await res.json();
            showActionToast(data.error || "Failed to leave");
        }
    } catch (err) { console.error(err); showActionToast("Failed to leave group"); }
}

// --- Refresh group info data ---
async function refreshGroupInfo() {
    if (!groupInfoData) return;
    try {
        const res = await fetch(`/api/groups/${groupInfoData.id}/info`);
        if (res.ok) {
            groupInfoData = await res.json();
            renderGroupInfo();
        }
    } catch (err) { console.error(err); }
}


// ==================
//  Read Receipts
// ==================

/** Mark all messages in a conversation as read by the current user */
async function markMessagesAsRead(conversationId) {
    try {
        await fetch("/api/messages/mark-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversation_id: conversationId }),
        });
    } catch (err) {
        console.error("Failed to mark messages as read:", err);
    }
}

/** Return a small tick icon for sent messages based on read status */
function getReadReceiptIcon(m) {
    const readCount = m.read_count || 0;
    if (readCount > 0) {
        // Blue double tick = read
        return `<span class="read-receipt read" title="${readCount} read">
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                <path d="M1 5.5L4 8.5L8 2" stroke="#53bdeb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M5 5.5L8 8.5L14 2" stroke="#53bdeb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>`;
    }
    // Grey double tick = delivered but not read
    return `<span class="read-receipt sent" title="Sent">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
            <path d="M1 5.5L4 8.5L8 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
            <path d="M5 5.5L8 8.5L14 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
        </svg>
    </span>`;
}

/** Show a modal with who has read the message */
async function showMessageInfo(msgId) {
    closeMsgContextMenu();
    try {
        const res = await fetch(`/api/messages/${msgId}/info`);
        if (!res.ok) {
            showActionToast("Failed to load message info");
            return;
        }
        const info = await res.json();

        // Build modal HTML
        let readListHtml = "";
        if (info.read_by.length === 0) {
            readListHtml = `<div class="msg-info-empty">No one has read this message yet</div>`;
        } else {
            info.read_by.forEach(u => {
                const avatarHtml = u.profile_pic
                    ? `<div class="avatar" style="overflow:hidden;background:transparent"><img src="${u.profile_pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`
                    : `<div class="avatar" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>`;
                readListHtml += `
                    <div class="msg-info-reader">
                        ${avatarHtml}
                        <span class="msg-info-reader-name">${escapeHtml(u.username)}</span>
                    </div>`;
            });
        }

        const modalHtml = `
            <div class="msg-info-overlay" id="msgInfoOverlay" onclick="closeMsgInfoModal(event)">
                <div class="msg-info-modal" onclick="event.stopPropagation()">
                    <div class="msg-info-header">
                        <h3>Message Info</h3>
                        <button class="icon-btn" onclick="closeMsgInfoModal()">&times;</button>
                    </div>
                    <div class="msg-info-section">
                        <div class="msg-info-section-title">
                            <svg width="16" height="16" viewBox="0 0 16 11" fill="none">
                                <path d="M1 5.5L4 8.5L8 2" stroke="#53bdeb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                                <path d="M5 5.5L8 8.5L14 2" stroke="#53bdeb" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                            Read by ${info.read_count} of ${info.total_recipients}
                        </div>
                        <div class="msg-info-reader-list">
                            ${readListHtml}
                        </div>
                    </div>
                </div>
            </div>`;

        // Remove existing modal if any
        const existing = document.getElementById("msgInfoOverlay");
        if (existing) existing.remove();

        document.body.insertAdjacentHTML("beforeend", modalHtml);
    } catch (err) {
        console.error("Failed to load message info:", err);
        showActionToast("Failed to load message info");
    }
}

function closeMsgInfoModal(e) {
    if (e && e.target !== e.currentTarget) return;
    const modal = document.getElementById("msgInfoOverlay");
    if (modal) modal.remove();
}
