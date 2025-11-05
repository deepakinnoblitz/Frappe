import { io } from "socket.io-client";

frappe.provide("frappe.realtime");

class RealTimeClient {
	constructor() {
		this.open_tasks = {};
		this.open_docs = new Set();
		this.socket = null;
		this.lazy_connect = false;
	}

	on(event, callback) {
		if (!this.socket) return;
		this.connect();
		this.socket.on(event, callback);
	}

	off(event, callback) {
		if (this.socket) this.socket.off(event, callback);
	}

	connect() {
		if (this.lazy_connect && this.socket) {
			this.socket.connect();
			this.lazy_connect = false;
		}
	}

	emit(event, ...args) {
		this.connect();
		if (this.socket) this.socket.emit(event, ...args);
	}

	init(lazy_connect = false) {
		if (frappe.boot.disable_async) return;
		if (this.socket) return;

		this.lazy_connect = lazy_connect;
		const socketHost = this.get_host();

		// ✅ FIX: connect using correct namespace for this site
		const namespace = frappe.boot.sitename ? `/${frappe.boot.sitename}` : "/";
		console.log(`🔌 Connecting to Socket.IO: ${socketHost}${namespace}`);

		this.socket = io(`${socketHost}${namespace}`, {
			secure: window.location.protocol === "https:",
			withCredentials: true,
			reconnectionAttempts: 5,
			reconnectionDelay: 2000,
			autoConnect: !lazy_connect,
			transports: ["polling", "websocket"],
			path: "/socket.io/",
		});

		this.register_core_listeners();
		this.setup_form_hooks();
	}


	get_host() {
		// ✅ Always connect through main site origin
		// nginx already proxies /socket.io/ → 127.0.0.1:9003 internally
		return window.location.origin;
	}

	register_core_listeners() {
		this.socket.on("connect", () => {
			console.log("✅ Socket connected:", this.socket.id);

			// ✅ Join user room after connect
			if (frappe.session?.user && frappe.session.user !== "Guest") {
				const user_room = `user:${frappe.session.user}`;
				console.log("🔔 Joining realtime room:", user_room);
				this.emit("room_join", user_room);
			}

			// 🔁 Rebind realtime events on reconnect
			if (frappe.chat?.setup_realtime_listeners) {
				console.log("🔄 Rebinding chat realtime listeners...");
				frappe.chat.setup_realtime_listeners();
			}
		});

		this.socket.on("disconnect", (reason) => {
			console.warn("⚠️ Socket disconnected:", reason);
		});

		this.socket.on("connect_error", (err) => {
			console.error("❌ Socket connect_error:", err.message);
		});

		this.socket.on("msgprint", (message) => frappe.msgprint(message));

		this.socket.on("progress", (data) => {
			if (data.progress) {
				data.percent = (flt(data.progress[0]) / data.progress[1]) * 100;
			}
			if (data.percent) {
				frappe.show_progress(
					data.title || __("Progress"),
					data.percent,
					100,
					data.description,
					true
				);
			}
		});

		this.setup_task_listeners();

		this.socket.onAny((event, data) => {
			console.log("📨 Incoming Realtime Event:", event, data);
			if (window.frappe && frappe.realtime?.handle) {
				frappe.realtime.handle(event, data);
			}
			if (["msg", "new_chat_notification", "typing"].includes(event)) {
				frappe.chat?.receive?.(data);
			}
		});
	}

	setup_task_listeners() {
		this.socket.on("task_status_change", (data) => {
			this.process_response(data, data.status.toLowerCase());
		});
		this.socket.on("task_progress", (data) => {
			this.process_response(data, "progress");
		});
	}

	setup_form_hooks() {
		const me = this;
		$(document).on("form-load form-rename", function (e, frm) {
			if (!frm.doc || frm.is_new()) return;
			me.doc_subscribe(frm.doctype, frm.docname);
		});
		$(document).on("form-refresh", function (e, frm) {
			if (!frm.doc || frm.is_new()) return;
			me.doc_open(frm.doctype, frm.docname);
		});
		$(document).on("form-unload", function (e, frm) {
			if (!frm.doc || frm.is_new()) return;
			me.doc_close(frm.doctype, frm.docname);
		});
	}

	// -----------------------
	//  Realtime event helpers
	// -----------------------
	subscribe(task_id, opts) {
		this.emit("task_subscribe", task_id);
		this.emit("progress_subscribe", task_id);
		this.open_tasks[task_id] = opts;
	}

	doc_subscribe(doctype, docname) {
		if (this.open_docs.has(`${doctype}:${docname}`)) return;
		this.emit("doc_subscribe", doctype, docname);
		this.open_docs.add(`${doctype}:${docname}`);
	}

	doc_unsubscribe(doctype, docname) {
		this.emit("doc_unsubscribe", doctype, docname);
		this.open_docs.delete(`${doctype}:${docname}`);
	}

	doc_open(doctype, docname) {
		this.emit("doc_open", doctype, docname);
	}

	doc_close(doctype, docname) {
		this.emit("doc_close", doctype, docname);
	}

	process_response(data, method) {
		if (!data) return;
		let opts = this.open_tasks[data.task_id];
		if (opts && opts[method]) opts[method](data);
		if (method === "success" && opts?.callback) opts.callback(data);
		frappe.request.cleanup(opts, data);
		if (opts?.always) opts.always(data);
		if (data.status_code > 400 && opts?.error) opts.error(data);
	}

	publish(event, message) {
		this.emit(event, message);
	}

	// --------------------
	// ✅ Frappe Compatibility Methods
	// --------------------
	doctype_subscribe(doctype) {
		this.emit("doctype_subscribe", doctype);
	}

	doctype_unsubscribe(doctype) {
		this.emit("doctype_unsubscribe", doctype);
	}

	task_subscribe(task_id) {
		this.emit("task_subscribe", task_id);
	}

	task_unsubscribe(task_id) {
		this.emit("task_unsubscribe", task_id);
	}
}

// ---- Initialize global client ----
frappe.realtime = new RealTimeClient();
frappe.realtime.init(false);
frappe.socketio = frappe.realtime;

console.log("✅ RealTimeClient initialized successfully (proxy → port 9003)");
