const { Server } = require("socket.io");
const http = require("node:http");
const fs = require("fs");
const path = require("path");
const { get_conf, get_redis_subscriber } = require("../node_utils");

const conf = get_conf();
const server = http.createServer();

let io = new Server(server, {
	cors: {
		origin: true,
		credentials: true,
	},
	cleanupEmptyChildNamespaces: true,
});

// ------------------------------
// 🔐 Authentication Middleware
// ------------------------------
const realtime = io.of(/^\/.*$/);
const authenticate = require("./middlewares/authenticate");
realtime.use(authenticate);

// ------------------------------
// 🎯 Connection Handler
// ------------------------------
function on_connection(socket) {
	socket.installed_apps.forEach((app) => {
		let app_handler = get_app_handlers(app);
		try {
			app_handler && app_handler(socket);
		} catch (err) {
			console.warn(`failed to setup event handlers from ${app}`);
			console.warn(err);
		}
	});

	// Optional: Debug connection
	console.log(`🧠 Socket connected [${socket.nsp.name}] → ${socket.id}`);

	socket.on("disconnect", (reason) => {
		console.log(`⚠️ Disconnected: ${socket.id} (${reason})`);
	});

	// For Frappe DevTools (open in editor)
	socket.on("open_in_editor", async (data) => {
		await subscriber.connect();
		subscriber.publish("open_in_editor", JSON.stringify(data));
	});
}

const _app_handlers = {};
function get_app_handlers(app) {
	if (app in _app_handlers) {
		return _app_handlers[app];
	}
	let file = `../../${app}/realtime/handlers.js`;
	let abs_path = path.resolve(__dirname, file);
	let handler = null;
	if (fs.existsSync(abs_path)) {
		try {
			handler = require(file);
		} catch (err) {
			console.warn(`failed to load event handlers from ${abs_path}`);
			console.warn(err);
		}
	}
	_app_handlers[app] = handler;
	return handler;
}

realtime.on("connection", on_connection);

// ------------------------------
// 🧠 Redis Subscription Logic
// ------------------------------
const subscriber = get_redis_subscriber();

(async () => {
	try {
		await subscriber.connect();
		console.log("✅ Redis subscriber connected");

		// 🟢 Subscribe to both channels
		await subscriber.subscribe("events:*", handleRedisMessage);
		await subscriber.subscribe("frappe.realtime.message", handleRedisMessage);

		console.log("📡 Listening for Redis events on channels:");
		console.log("  → events:*");
		console.log("  → frappe.realtime.message");
	} catch (err) {
		console.error("❌ Redis subscription failed:", err);
	}
})();

function handleRedisMessage(rawMessage) {
	try {
		const message = JSON.parse(rawMessage);
		const namespace = "/" + (message.namespace || conf.default_site || "");
		const target = message.room || null;

		console.log(
			`📨 Redis → Socket.IO: [${namespace}] Event=${message.event}, Room=${target || "all"}`
		);

		if (target) {
			io.of(namespace).to(target).emit(message.event, message.message);
		} else {
			realtime.emit(message.event, message.message);
		}
	} catch (err) {
		console.error("⚠️ Failed to handle Redis message:", err, rawMessage);
	}
}

// ------------------------------
// 🚀 Start Server
// ------------------------------
let uds = conf.socketio_uds;
let port = conf.socketio_port || 9003;
server.listen(uds || port, () => {
	if (uds) {
		console.log(`Realtime service listening on UDS: ${uds}`);
	} else {
		console.log(`🚀 Realtime service listening on: ws://0.0.0.0:${port}`);
	}
});
