// =====================================================================
// 1️⃣  SUPPRESS ONLY THE "Cannot delete…" MESSAGE (safe override)
// =====================================================================
let _original_msgprint = frappe.msgprint;

frappe.msgprint = function (opts) {
	let msg = "";

	if (typeof opts === "string") {
		msg = opts;
	} else if (opts && opts.message) {
		msg = opts.message;
	}

	// Suppress ONLY Calls delete warning
	if (msg.includes("Cannot delete or cancel because Calls")) {
		console.log("⚠️ Suppressed Frappe default link warning");
		return false;
	}

	return _original_msgprint(opts);
};



frappe.views.calendar["ToDo"] = {
	field_map: {
		start: "date",
		end: "date",
		id: "name",
		title: "description",
		allDay: "allDay",
		progress: "progress",
		priority: "priority",
		status: "status"
	},

	get_events_method: "frappe.desk.calendar.get_events",

	options: {
		firstDay: 0,

		eventDidMount(info) {

			// -------------------------------
			// PRIORITY DOT (Gradient)
			// -------------------------------
			const priorityGradients = {
				"High": "linear-gradient(135deg, #ff6b6b, #e03131)",
				"Medium": "linear-gradient(135deg, #ffd43b, #f59f00)",
				"Low": "linear-gradient(135deg, #20a4e5, #1fa7ea)"
			};

			let priority = info.event.extendedProps.priority;
			let gradient =
				priorityGradients[priority] ||
				"linear-gradient(135deg, #ced4da, #868e96)";

			let dot = `
                <span style="
                    width: 12px; height: 12px;
                    display: inline-block;
                    border-radius: 50%;
                    background: ${gradient};
                    border: 1.5px solid rgba(255,255,255,0.9);
                    box-shadow: 0 0 4px rgba(0,0,0,0.25),
                                inset 0 0 6px rgba(255,255,255,0.5);
                    flex-shrink: 0;
                "></span>
            `;

			// -------------------------------
			// FIND TITLE ELEMENT
			// -------------------------------
			let titleEl =
				info.el.querySelector(".fc-event-title.fc-sticky") ||
				info.el.querySelector(".fc-event-title") ||
				info.el.querySelector(".fc-event-main-frame .fc-event-title")

			if (!titleEl) return;

			let original = titleEl.textContent.trim();
			original = frappe.utils.escape_html(original);

			titleEl.style.display = "flex";
			titleEl.style.alignItems = "center";
			titleEl.style.gap = "6px";
			titleEl.style.whiteSpace = "nowrap";

			titleEl.innerHTML = `${dot}<span>${original}</span>`;


			// -------------------------------
			// FULL BAR BACKGROUND BY STATUS
			// -------------------------------
			const statusColors = {
				"Open": "#e03131",
				"Closed": "#2f9e44",
				"Cancelled": "#868e96"
			};

			let status = info.event.extendedProps.status;
			let bgColor = statusColors[status] || "#868e96";

			// Apply full background color
			info.el.style.setProperty("background", bgColor, "important");
			info.el.style.setProperty("border-color", bgColor, "important");

			// Make text readable
			info.el.style.color = "#ffffff";

			// Rounded bars
			info.el.style.borderRadius = "6px";

			// Remove any inherited calendar borders
			info.el.style.borderWidth = "0px";


			// -------------------------------
			// DELETE BUTTON
			// -------------------------------
			let deleteBtn = document.createElement("a");
			deleteBtn.classList.add("delete-btn");
			deleteBtn.setAttribute("title", "Delete");

			deleteBtn.style.cssText = `
                position: absolute;
                top: 2px; right: 4px;
                cursor: pointer;
                z-index: 10000;
                width: 20px; height: 20px;
                background: #ffffff;
                border-radius: 50%;
                display: none;
                align-items: center; justify-content: center;
                box-shadow: 0 2px 6px rgba(0,0,0,0.15);
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

                if (window.__todo_dragging) return;

                deleteBtn.style.display = "flex";

                cleanup_todo_popup();   // 🔥 IMPORTANT

                fetch_todo_details(info.event.id, (todo) => {

                    const popup = create_todo_info_popup(todo);
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
                cleanup_todo_popup();   // 🔥 IMPORTANT
            });

            // ------------------------------
            // Delete click
            // ------------------------------
            deleteBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cleanup_todo_popup();
                delete_todo(info.event.id, info);
            };

			info.el.style.position = "relative";
			info.el.appendChild(deleteBtn);
		}
	}
};

// =====================================================================
// 3️⃣ FIRST TRY: CHECK IF CALL IS LINKED WITH EVENT
// =====================================================================
function delete_todo(todo_id, info) {

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Event",
			fields: ["name"],
			filters: {
				reference_doctype: "ToDo",
				reference_docname: todo_id
			},
			limit: 1
		},

		callback: function (res) {

			// 👉 NOT linked → ask confirmation
			if (!res.message || res.message.length === 0) {
				confirm_delete_todo_only(todo_id, info);
				return;
			}

			// 👉 Linked → show delete options popup
			show_delete_options(todo_id, info);
		}
	});
}


// =====================================================================
// 4️⃣ POPUP: ToDo IS LINKED WITH EVENT
// =====================================================================
let deleteDialog = null;

function show_delete_options(todo_id, info) {

	deleteDialog = new frappe.ui.Dialog({
		title: "Delete Options",
		indicator: "red",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "delete_html",
				options: `
                    <p>The ToDO <b>${todo_id}</b> is linked with a Calendar Event.</p>
                    <p>Choose an action:</p>
                    <button class="btn btn-danger" id="delete_both_btn">
                        Delete ToDO + Event
                    </button>
                `
			}
		]
	});

	deleteDialog.show();

	// Handle delete click
	setTimeout(() => {
		deleteDialog.$wrapper.find('#delete_both_btn').on('click', () => {
			deleteDialog.hide();
			delete_both_records(todo_id, info);
		});
	}, 50);
}

// =====================================================================
// 5️⃣ NOT LINKED → SHOW CONFIRM DELETE ONLY ToDO
// =====================================================================
function confirm_delete_todo_only(todo_id, info) {

	let dialog = new frappe.ui.Dialog({
		title: "Confirm Delete",
		indicator: "orange",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "confirm_html",
				options: `
                    <p>This ToDO is <b>not linked</b> with any Calendar Event.</p>
                    <p>Do you want to delete only the ToDO?</p>

                    <button class="btn btn-danger" id="delete_todo_only_btn">Yes, Delete ToDO</button>
                    <button class="btn btn-secondary" id="cancel_delete_btn">Cancel</button>
                `
			}
		]
	});

	dialog.show();

	setTimeout(() => {

		dialog.$wrapper.find("#delete_todo_only_btn").on("click", function () {
			dialog.hide();

			frappe.call({
				method: "frappe.client.delete",
				args: { doctype: "ToDo", name: todo_id },

				callback: function () {
					frappe.show_alert("ToDo deleted");
					info.event.remove();
				}
			});
		});

		dialog.$wrapper.find("#cancel_delete_btn").on("click", function () {
			dialog.hide();
		});

	}, 50);
}


// =====================================================================
// 6️⃣ DELETE EVENT → THEN DELETE CALL (LINKED CASE)
// =====================================================================
function delete_both_records(todo_id, info) {

	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype: "Event",
			fields: ["name"],
			filters: {
				reference_doctype: "ToDo",
				reference_docname: todo_id
			},
			limit: 1
		},

		callback: function (res) {
			if (!res.message || res.message.length === 0) {
				frappe.msgprint("No linked Event found.");
				return;
			}

			let event_id = res.message[0].name;

			// Step 1 — Delete Event
			frappe.call({
				method: "frappe.client.delete",
				args: { doctype: "Event", name: event_id },

				callback: function () {

					// Step 2 — Delete Call
					frappe.call({
						method: "frappe.client.delete",
						args: { doctype: "ToDo", name: todo_id },

						callback: function () {
							frappe.show_alert("ToDo & Event deleted successfully!");
							info.event.remove();
						}
					});
				}
			});
		}
	});
}

function create_todo_info_popup(todo) {
	const box = document.createElement("div");

	const status = (todo.status || "Unknown").toLowerCase();

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

            <span class="todo-title">${todo.description || "ToDo"}</span>
        </div>

        <div class="popup-body">

            <div class="popup-row">
                <span class="label">Due Date</span>
                <span class="value">
                    ${frappe.datetime.str_to_user(todo.date)}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">Status</span>
                <span class="status-badge status-${status}">
                    ${todo.status || "Unknown"}
                </span>
            </div>

            <div class="popup-row">
                <span class="label">Priority</span>
                <span class="value">${todo.priority || "—"}</span>
            </div>

        </div>
    `;

	return box;
}



function fetch_todo_details(todo_id, callback) {
	frappe.call({
		method: "frappe.client.get",
		args: {
			doctype: "ToDo",
			name: todo_id
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

function cleanup_todo_popup() {
	document
		.querySelectorAll(".todo-info-popup")
		.forEach(p => p.remove());
}
