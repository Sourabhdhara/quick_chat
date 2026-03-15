// Context menu for conversations

function openConvoContextMenu(event, convoId) {
    event.preventDefault();
    closeConvoContextMenu();

    const menu = document.createElement("div");
    menu.className = "convo-context-menu";
    menu.innerHTML = `
        <div class="convo-context-item" onclick="deleteConversation('${convoId}')">Delete conversation</div>
    `;

    document.body.appendChild(menu);
    const rect = event.target.getBoundingClientRect();
    menu.style.top = `${event.clientY}px`;
    menu.style.left = `${event.clientX}px`;

    document.addEventListener("click", closeConvoContextMenu);
}

function closeConvoContextMenu() {
    const existing = document.querySelector(".convo-context-menu");
    if (existing) existing.remove();
    document.removeEventListener("click", closeConvoContextMenu);
}
