frappe.views.calendar["Event"] = {
    field_map: {
        start: "starts_on",
        end: "ends_on",
        id: "name",
        allDay: "all_day",
        title: "subject",
        status: "event_type",
        color: "color",
        event_category: "event_category"
    },

    // ⭐ Use your custom API
    get_events_method: "company.company.crm_api.get_events_with_category",

    options: {
        firstDay: 0,

        eventDidMount(info) {

            // ----------  WHITE SVG ICONS  ----------
            const eventIcons = {
                "Call": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <path d="M6.62 10.79a15.093 15.093 0 006.59 6.59l2.2-2.2a1 
                        1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 
                        011 1v3.5a1 1 0 01-1 1A17 17 0 013 5a1 1 0 011-1h3.5a1 1 0 
                        011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.24 1.01l-2.21 2.2z"/>
                    </svg>
                `,

                "Meeting": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <path d="M7 10h10v2H7zm0-4h10v2H7zm0 
                        8h7v2H7zm13-11h-3V1h-2v2H9V1H7v2H4a2 
                        2 0 00-2 2v15a2 2 0 002 2h16a2 2 0 
                        002-2V5a2 2 0 00-2-2zm0 17H4V9h16v11z"/>
                    </svg>
                `,

                "Event": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 
                        9.24l-7.19-.61L12 2 9.19 8.63 2 
                        9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                `,

                "Sent/Received Email": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <path d="M12 13L2 6.76V18a2 2 0 002 
                        2h16a2 2 0 002-2V6.76L12 
                        13zm10-9H2l10 6 10-6z"/>
                    </svg>
                `,

                "Other": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                `,

                "Todo": `
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="#ffffff" viewBox="0 0 24 24">
                        <path d="M12 1a11 11 0 1 0 11 11A11.013 11.013 0 0 0 12 1zm0 20a9 9 0 1 1 9-9 9.01 9.01 0 0 1-9 9zm.5-14h-1v6l5 3 .5-.86-4.5-2.64z"/>
                    </svg>
                `
            };

            // Get event category
            let category = info.event.extendedProps.event_category;
            let icon = eventIcons[category] || "";

            // Insert SVG icon before the title
            let titleEl = info.el.querySelector(".fc-event-title");
            if (icon && titleEl) {
                titleEl.innerHTML = `${icon} <span style="margin-left:4px;">${titleEl.innerHTML}</span>`;
            }

            // ----------  DELETE BUTTON  ----------
            let deleteBtn = document.createElement("a");
            deleteBtn.classList.add("delete-btn");
            deleteBtn.setAttribute("title", "Delete");

            deleteBtn.style.cssText = `
                position: absolute;
                top: 2px;
                right: 4px;
                cursor: pointer;
                z-index: 10000;
                width: 20px;
                height: 20px;
                background: #ffffff;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            deleteBtn.innerHTML = `
                <svg class="icon icon-sm delete-icon"
                    style="width:12px; height:12px; stroke:#e03131; stroke-width:2;">
                    <use href="#icon-delete"></use>
                </svg>
            `;

            // ------------------------------
            // Hover → show popup
            // ------------------------------
            info.el.addEventListener("mouseenter", () => {

                if (window.__event_dragging) return;

                deleteBtn.style.display = "flex";

                cleanup_event_popup();   // 🔥 IMPORTANT

                fetch_event_details(info.event.id, (event) => {

                    const popup = create_popup_for_event(event);
                    document.body.appendChild(popup);

                    position_popup(info.el, popup);
                    popup.classList.add("show");
                });
            });

            // ------------------------------
            // Mouse leave → cleanup
            // ------------------------------
            info.el.addEventListener("mouseleave", () => {
                deleteBtn.style.display = "none";
                cleanup_event_popup();   // 🔥 IMPORTANT
            });

            // ------------------------------
            // Delete click
            // ------------------------------
            deleteBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup_event_popup();
                delete_event(info.event.id, info);
            };

            info.el.style.position = "relative";
            info.el.appendChild(deleteBtn);
        }
    }
};


function delete_event(event_id, info) {

    frappe.confirm(
        __("Are you sure you want to delete this Event?"),
        () => {
            frappe.call({
                method: "frappe.client.delete",
                args: {
                    doctype: "Event",
                    name: event_id
                },
                callback: function () {
                    frappe.show_alert({
                        message: __("Event deleted"),
                        indicator: "green"
                    });

                    // Remove from calendar UI
                    if (info && info.event) {
                        info.event.remove();
                    }
                }
            });
        }
    );
}



function create_popup_for_event(event) {

    // 🔥 Case 1: Event is linked to ToDo
    if (
        event.reference_doctype === "ToDo" ||
        (event.event_category && event.event_category.toLowerCase() === "todo")
    ) {
        return create_todo_info_popup(event);
    }

    // 🔥 Default: Normal Event / Call / Meeting
    return create_event_info_popup(event);
}



function create_event_info_popup(event) {
    const box = document.createElement("div");

    const status = (event.status || "Unknown").toLowerCase();

    box.className = "event-info-popup";
    box.innerHTML = `
        <div class="popup-header">
            ${get_event_icon(event.event_category)}

            <span class="event-title">${event.subject || "Event"}</span>
        </div>

        <div class="popup-body">

            <div class="popup-row">
                <span class="label">Start</span>
                <span class="value">
                    ${frappe.datetime.str_to_user(event.starts_on)}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">End</span>
                <span class="value">
                    ${event.ends_on
            ? frappe.datetime.str_to_user(event.ends_on)
            : "—"}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">Type</span>
                <span class="value">${event.event_category || "—"}</span>
            </div>
            
            <div class="popup-row">
                <span class="label">Status</span>
                <span class="status-badge status-${status}">
                    ${event.status || "Unknown"}
                </span>
            </div>

        </div>
    `;

    return box;
}


function create_todo_info_popup(event) {
    const box = document.createElement("div");

    const status = (event.status || "Unknown").toLowerCase();

    box.className = "todo-info-popup";
    box.innerHTML = `
        <div class="popup-header">
            <svg class="todo-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 2v2H6a2 2 0 0 0-2 2v14
                        a2 2 0 0 0 2 2h12
                        a2 2 0 0 0 2-2V6
                        a2 2 0 0 0-2-2h-2V2
                        h-2v2h-4V2H8zm10 18H6V9h12v11zm-6-8
                        v4l3 1"/>
            </svg>

            <span class="todo-title">${event.title || "ToDo"}</span>
        </div>

        <div class="popup-body">

            <div class="popup-row">
                <span class="label">Due Date</span>
                <span class="value">
                    ${frappe.datetime.str_to_user(event.starts_on)}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">Status</span>
                <span class="status-badge status-${status}">
                    ${event.status || "Unknown"}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">Priority</span>
                <span class="value">${event.priority || "—"}</span>
            </div>

        </div>
    `;

    return box;
}


function fetch_event_details(event_id, callback) {
    frappe.call({
        method: "frappe.client.get",
        args: {
            doctype: "Event",
            name: event_id
        },
        callback: function (res) {
            if (res.message) {
                callback(res.message);
            }
        }
    });
}

function position_popup(targetEl, popup) {

    const rect = targetEl.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const padding = 8;

    const space = {
        top: rect.top,
        bottom: window.innerHeight - rect.bottom,
        left: rect.left,
        right: window.innerWidth - rect.right
    };

    // Priority order
    let position = "right";

    if (space.right >= popupRect.width + padding) {
        position = "right";
    } else if (space.left >= popupRect.width + padding) {
        position = "left";
    } else if (space.bottom >= popupRect.height + padding) {
        position = "bottom";
    } else {
        position = "top";
    }

    let top, left;

    switch (position) {
        case "right":
            top = rect.top + rect.height / 2 - popupRect.height / 2;
            left = rect.right + padding;
            break;

        case "left":
            top = rect.top + rect.height / 2 - popupRect.height / 2;
            left = rect.left - popupRect.width - padding;
            break;

        case "bottom":
            top = rect.bottom + padding;
            left = rect.left + rect.width / 2 - popupRect.width / 2;
            break;

        case "top":
            top = rect.top - popupRect.height - padding;
            left = rect.left + rect.width / 2 - popupRect.width / 2;
            break;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - popupRect.height - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8));

    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
}

function cleanup_event_popup() {
    document
        .querySelectorAll(".event-info-popup, .todo-info-popup")
        .forEach(p => p.remove());
}

function get_event_icon(category) {
    category = (category || "").toLowerCase();

    // 📞 CALL
    if (category === "call" || category === "calls") {
        return `
            <svg class="event-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2
                         19.79 19.79 0 0 1-8.63-3.07
                         19.5 19.5 0 0 1-6-6
                         19.79 19.79 0 0 1-3.07-8.67
                         A2 2 0 0 1 4.11 2h3
                         a2 2 0 0 1 2 1.72
                         12.44 12.44 0 0 0 .7 2.81
                         2 2 0 0 1-.45 2.11L8.09 9.91
                         a16 16 0 0 0 6 6l1.27-1.27
                         a2 2 0 0 1 2.11-.45
                         12.44 12.44 0 0 0 2.81.7
                         A2 2 0 0 1 22 16.92z"/>
            </svg>`;
    }

    // 🤝 MEETING
    if (category === "meeting") {
        return `
            <svg class="event-svg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 2v2H6a2 2 0 0 0-2 2v14
                         a2 2 0 0 0 2 2h12
                         a2 2 0 0 0 2-2V6
                         a2 2 0 0 0-2-2h-2V2
                         h-2v2h-4V2H8zm10 18H6V9h12v11z"/>
            </svg>`;
    }

    // 📅 DEFAULT EVENT
    return `
        <svg class="event-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 2v2H5a2 2 0 0 0-2 2v14
                     a2 2 0 0 0 2 2h14
                     a2 2 0 0 0 2-2V6
                     a2 2 0 0 0-2-2h-2V2
                     h-2v2H9V2H7zm12 18H5V9h14v11z"/>
        </svg>`;
}
