import { DurableObject } from "cloudflare:workers";
import minecraft from "./minecraft";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

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

	async alarm() {
		const endTime = await this.ctx.storage.get<number | undefined>("endTime");
		if (!endTime) return;  // Already cancelled or expired

		const now = Date.now();
		const timeLeftMs = endTime - now;

		if (timeLeftMs <= 0) {
			// Time's up: Reboot and clean up
			await minecraft.reboot_server(this.env);
			await this.ctx.storage.delete("endTime");
			return;
		}

		// Determine the current message band and next alarm
		let message;
		let nextAlarmTime;

		if (timeLeftMs <= 10 * 1000) {
			message = "10 seconds";
			nextAlarmTime = endTime;  // Next: reboot
		} else if (timeLeftMs <= 1 * 60 * 1000) {
			message = "1 minute";
			nextAlarmTime = endTime - 10 * 1000;  // Next: 10 sec message
		} else if (timeLeftMs <= 5 * 60 * 1000) {
			message = "5 minutes";
			nextAlarmTime = endTime - 1 * 60 * 1000;  // Next: 1 min message
		} else if (timeLeftMs <= 15 * 60 * 1000) {
			message = "15 minutes";
			nextAlarmTime = endTime - 5 * 60 * 1000;  // Next: 5 min message
		} else {
			// Shouldn't reach here if scheduled correctly, but recover by setting to 15 min mark
			nextAlarmTime = endTime - 15 * 60 * 1000;
			return await this.ctx.storage.setAlarm(nextAlarmTime);
		}

		// check if online
		const status = await minecraft.check_server(this.env);
		if (status.players.online == 0) {
			await minecraft.send_message(this.env, "Rebooting early because no players are online anymore");
			await minecraft.reboot_server(this.env);
			await this.ctx.storage.delete("endTime");
			return;
		}

		// Send the message
		await minecraft.send_message(this.env, `Restarting in ${message}`);

		// Set next alarm
		await this.ctx.storage.setAlarm(nextAlarmTime);
	}

	async setupAlarm() {
		await minecraft.send_message(this.env, "Rebooting in 30 minutes");
		await this.ctx.storage.setAlarm(Date.now() + 15 * 60 * 1000);
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
		else {
			return index();
		}
	},

	async scheduled(event, env, ctx) {
		const stub = env.CF_MINECRAFT_REBOOT_DO.getByName("foo");
		await stub.rebootNowOrSchedule();
	},
} satisfies ExportedHandler<Env>;
