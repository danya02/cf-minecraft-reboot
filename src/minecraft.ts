import { getStatus } from "./contrib/status";

export default {
	// async check_server(env: Env) {
	// 	const serverHost = env.MINECRAFT_SERVER;

	// 	// Fetch server status via API
	// 	const headers = new Headers();
	// 	headers.set("Content-Type", "application/json");
	// 	headers.set("User-Agent", "cf-minecraft-reboot from threeforths.uk (github.com/danya02/cf-minecraft-reboot)",);
	// 	const statusResponse = await fetch(`https://api.mcsrvstat.us/2/${serverHost}`, {
	// 		method: "GET",
	// 		headers: headers,
	// 	});
	// 	const status: {online: boolean, players: {online: number}} = await statusResponse.json();
	// 	console.log(status);
	// 	return status;
	// },

	async check_server(env: Env) {
		const serverHost = env.MINECRAFT_SERVER;
		const status = await getStatus(serverHost);
		return status;
	},

	async reboot_server(env: Env) {
		const pteroHost = env.PTERO_HOST;
		const pteroServer = env.PTERO_SERVER;
		const pteroApiToken = env.PTERO_API_TOKEN;

		const url = `${pteroHost}/api/client/servers/${pteroServer}/power`;
		console.log("Rebooting server with POST to: " + url);
		const headers = {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${pteroApiToken}`,
			"User-Agent": "cf-minecraft-reboot from threeforths.uk (github.com/danya02/cf-minecraft-reboot)",
		};

		const resp = await fetch(url, {
			method: "POST",
			headers: headers,
			body: JSON.stringify({
				"signal": "restart",
			}),
		});

		const text = await resp.text();
		console.log("Response: " + resp.status + " " + resp.statusText + " " + text);

		return resp.status;
	},

	async send_message(env: Env, message: string) {
		const pteroHost = env.PTERO_HOST;
		const pteroServer = env.PTERO_SERVER;
		const pteroApiToken = env.PTERO_API_TOKEN;

		const url = `${pteroHost}/api/client/servers/${pteroServer}/command`;
		console.log("Sending message to server with POST to: " + url);
		const headers = {
			"Content-Type": "application/json",
			"Authorization": `Bearer ${pteroApiToken}`,
			"User-Agent": "cf-minecraft-reboot from threeforths.uk (github.com/danya02/cf-minecraft-reboot)",
		};

		const resp = await fetch(url, {
			method: "POST",
			headers: headers,
			body: JSON.stringify({
				"command": `say ${message}`,
			}),
		});

		const text = await resp.text();
		console.log("Response: " + resp.status + " " + resp.statusText + " " + text);

		return resp.status;
	}
}
