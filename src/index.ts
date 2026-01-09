import { DurableObject } from "cloudflare:workers";
import minecraft from "./minecraft";
import { getStatus } from "./contrib/status";


/** A Durable Object's behavior is defined in an exported Javascript class */
export class CfMinecraftRebootDurableObject extends DurableObject<Env> {
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async fetchStatus(): Promise<string> {
		const status = await minecraft.check_server(this.env);
		return JSON.stringify(status);
	}

	async cancelReboot() {
		await this.ctx.storage.delete("endTime");
		await this.ctx.storage.delete("nextMessageTime");
	}

	async alarm() {
		const endTime = await this.ctx.storage.get<number | undefined>("endTime");
		if (!endTime) {
			// Already cancelled or expired
			minecraft.send_message(this.env, "Restart cancelled");
			await this.ctx.storage.delete("endTime");
			await this.ctx.storage.delete("nextMessageTime");
			return;
		}

		const now = Date.now();
		const timeLeftMs = endTime - now;
		console.log("Running at " + new Date() + " with " + timeLeftMs + "ms left until reboot");

		if (timeLeftMs <= 0) {
			// Time's up: Reboot and clean up
			await minecraft.reboot_server(this.env);
			await this.ctx.storage.delete("endTime");
			await this.ctx.storage.delete("nextMessageTime");  // Clean up
			return;
		}

		let nextMessageTime = await this.ctx.storage.get<number | undefined>("nextMessageTime");
		if (!nextMessageTime) {
			nextMessageTime = now;  // Trigger immediate evaluation
		}

		// check if online
		const status = await minecraft.check_server(this.env);
		console.log("Players online: " + status.players.online);
		if (status.players.online == 0) {
			await minecraft.send_message(this.env, "Restarting early because no players are online anymore");
			await minecraft.reboot_server(this.env);
			await this.ctx.storage.delete("endTime");
			await this.ctx.storage.delete("nextMessageTime");
			return;
		}

		// Check if it's time to send a message
		if (now >= nextMessageTime) {
			let message;
			let nextNextMessageTime;

			if (timeLeftMs > 15 * 60 * 1000) {
				// No message yet
				nextNextMessageTime = endTime - 15 * 60 * 1000;
			} else if (timeLeftMs <= 15 * 60 * 1000 && timeLeftMs > 5 * 60 * 1000) {
				message = "15 minutes";
				nextNextMessageTime = endTime - 5 * 60 * 1000;
			} else if (timeLeftMs <= 5 * 60 * 1000 && timeLeftMs > 1 * 60 * 1000) {
				message = "5 minutes";
				nextNextMessageTime = endTime - 1 * 60 * 1000;
			} else if (timeLeftMs <= 1 * 60 * 1000 && timeLeftMs > 10 * 1000) {
				message = "1 minute";
				nextNextMessageTime = endTime - 10 * 1000;
			} else if (timeLeftMs <= 10 * 1000) {
				message = "10 seconds";
				nextNextMessageTime = endTime;
			}

			if (message) {
				// Send the message
				await minecraft.send_message(this.env, `Restarting in ${message}`);
			}

			// Update next message time
			nextMessageTime = nextNextMessageTime;
			await this.ctx.storage.put("nextMessageTime", nextMessageTime);
		}

		// Set next alarm: every 30 seconds, but sooner if next message or end is earlier
		let nextAlarmTime = now + 30 * 1000;
		if (!nextMessageTime) {
			nextMessageTime = now;  // Trigger immediate evaluation
		}
		if (nextMessageTime < nextAlarmTime) {
			nextAlarmTime = nextMessageTime;
		}
		if (endTime < nextAlarmTime) {
			nextAlarmTime = endTime;
		}
		console.log("Scheduling alarm for " + new Date(nextAlarmTime) + " which is in " + (nextAlarmTime - now)/1000 + "s");
		await this.ctx.storage.setAlarm(nextAlarmTime);
	}

	async setupAlarm() {
		await minecraft.send_message(this.env, "Rebooting in 30 minutes");
		await this.ctx.storage.setAlarm(Date.now() + 30 * 1000); // run in 30 seconds
		await this.ctx.storage.put("endTime", Date.now() + 30 * 60 * 1000);
	}

	async rebootNowOrSchedule() {
		const status = await minecraft.check_server(this.env);
		if (status.players.online > 0) {
			return await this.setupAlarm();
		} else {
			await minecraft.send_message(this.env, "Rebooting immediately because no players online");
			await minecraft.reboot_server(this.env);
		}
	}

	async immediateReboot() {
		await minecraft.send_message(this.env, "Rebooting now");
		return await minecraft.reboot_server(this.env);
	}
}

async function index() {
	const page = `
	<h1>CF Minecraft Reboot controller</h1>
	<ul>
	<li><a href="/reboot-now">Reboot immediately</a></li>
	<li><a href="/send-test-message">Send test message</a></li>
	<li><a href="/schedule-reboot">Schedule reboot</a></li>
	<li><a href="/cancel-reboot">Cancel reboot</a></li>
	<li><a href="/reboot-now-or-schedule">Reboot now or schedule (does the same thing as if the timer just expired)</a></li>
	<li><a href="/get-mc-status">Get Minecraft server status</a></li>
	</ul>
	`;

	return new Response(page, {
		headers: {
			"content-type": "text/html",
		},
	});
}

async function rebootNow(env: Env) {
	const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
	const status = await stub.immediateReboot();
	return new Response("Reboot command returned status: " + status.toString(), {
		headers: {
			"content-type": "text/plain",
		},
	});
}

async function sendTestMessage(env: Env) {
	const status = await minecraft.send_message(env, "Test message from cf-minecraft-reboot worker");
	return new Response("Reboot command returned status: " + status.toString(), {
		headers: {
			"content-type": "text/plain",
		},
	});
}

async function scheduleReboot(env: Env) {
	const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
	await stub.setupAlarm();

	return new Response("Reboot scheduled", {
		headers: {
			"content-type": "text/plain",
		},
	});
}

async function cancelReboot(env: Env) {
	const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
	await stub.cancelReboot();
	return new Response("Reboot cancelled", {
		headers: {
			"content-type": "text/plain",
		},
	});
}

async function getMcStatus(env: Env) {
	const status = await getStatus(env.MINECRAFT_SERVER);
	return new Response(JSON.stringify(status), {
		headers: {
			"content-type": "text/plain",
		},
	});
}


export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {

		if (request.url.endsWith("/reboot-now")) {
			return rebootNow(env);
		}
		else if (request.url.endsWith("/send-test-message")) {
			return sendTestMessage(env);
		}
		else if (request.url.endsWith("/schedule-reboot")) {
			return scheduleReboot(env);
		}
		else if (request.url.endsWith("/cancel-reboot")) {
			return cancelReboot(env);
		}
		else if (request.url.endsWith("/reboot-now-or-schedule")) {
			const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
			await stub.rebootNowOrSchedule();
			return new Response("Command sent to durable object", {
				headers: {
					"content-type": "text/plain",
				},
			})
		}
		else if (request.url.endsWith("/get-mc-status")) {
			return getMcStatus(env);
		}
		else {
			return index();
		}
	},

	async scheduled(event, env, ctx) {
		const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
		await stub.rebootNowOrSchedule();
	},
} satisfies ExportedHandler<Env>;
