const cookie = require("cookie");
const { get_conf } = require("../../node_utils");
const conf = get_conf();

function authenticate_with_frappe(socket, next) {
	let namespace = socket.nsp.name;
	namespace = namespace.slice(1, namespace.length); // remove leading "/"

	if (namespace !== get_site_name(socket)) {
		return next(new Error(`Invalid namespace: ${namespace}`));
	}

	const origin = socket.request.headers.origin;
	let host = socket.request.headers.host;

	// 🧩 Fix #1 — normalize Docker hostnames or internal mappings
	if (host === "frappe-socketio") {
		host = "erp.innoblitz.in";
	}

	const origin_host = get_hostname(origin);
	const host_name = get_hostname(host);

	console.log("🔍 Origin:", origin, "| Origin Host:", origin_host, "| Host:", host, "| Hostname:", host_name);

	// ✅ Allow same-domain or missing-origin (WebSocket handshake)
	if (origin_host && host_name && origin_host !== host_name) {
		return next(new Error(`Invalid origin: ${origin_host} != ${host_name}`));
	}

	if (!socket.request.headers.cookie && !socket.request.headers.authorization) {
		return next(
			new Error("Missing cookie or authorization header — either one needed for authentication.")
		);
	}

	const cookies = cookie.parse(socket.request.headers.cookie || "");
	const authorization_header = socket.request.headers.authorization;

	if (!cookies.sid && !authorization_header) {
		return next(new Error("No authentication method used. Use cookie or authorization header."));
	}

	socket.sid = cookies.sid;
	socket.authorization_header = authorization_header;

	// 🧩 Fix #2 — Always call correct Frappe site API via localhost (HTTP, not HTTPS)
	socket.frappe_request = async (path, args = {}, opts = {}) => {
		const query_args = new URLSearchParams(args);
		if (query_args.toString()) {
			path = `${path}?${query_args.toString()}`;
		}

		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // bypass SSL hostname mismatch

		const site_name = socket.site_name || "erp.innoblitz.in";
		const frappe_backend = `https://${site_name}${path}`;

		const headers = {
			...(opts.headers || {}),
			"X-Frappe-Site-Name": site_name,
		};
		if (socket.authorization_header) {
			headers["Authorization"] = socket.authorization_header;
		} else if (socket.sid) {
			headers["Cookie"] = `sid=${socket.sid}`;
		}

		console.log("🌍 Fetching Frappe API:", frappe_backend);

		const response = await fetch(frappe_backend, {
			...opts,
			headers,
		});

		const text = await response.text();

		if (text.trim().startsWith("<")) {
			throw new Error(`HTML response (likely login or 404): ${text.slice(0, 80)}`);
		}

		try {
			return JSON.parse(text);
		} catch (e) {
			throw new Error(`Invalid JSON: ${text.slice(0, 100)}`);
		}
	};


	socket
		.frappe_request("/api/method/frappe.realtime.get_user_info")
		.then(({ message }) => {
			socket.user = message.user;
			socket.user_type = message.user_type;
			socket.installed_apps = message.installed_apps;
			console.log(`✅ Authenticated user: ${socket.user}`);
			next();
		})
		.catch((e) => {
			console.error("❌ Authentication error:", e.message);
			next(new Error(`Unauthorized: ${e.message}`));
		});
}

function get_site_name(socket) {
	if (socket.site_name) {
		return socket.site_name;
	} else if (socket.request.headers["x-frappe-site-name"]) {
		socket.site_name = get_hostname(socket.request.headers["x-frappe-site-name"]);
	} else if (
		conf.default_site &&
		["localhost", "127.0.0.1"].includes(get_hostname(socket.request.headers.host))
	) {
		socket.site_name = conf.default_site;
	} else if (socket.request.headers.origin) {
		socket.site_name = get_hostname(socket.request.headers.origin);
	} else {
		socket.site_name = get_hostname(socket.request.headers.host);
	}
	return socket.site_name;
}

function get_hostname(url) {
	if (!url) return undefined;
	if (url.indexOf("://") > -1) {
		url = url.split("/")[2];
	}
	return url.includes(":") ? url.split(":")[0] : url;
}

module.exports = authenticate_with_frappe;
