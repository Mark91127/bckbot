import { LocalizableInteractionReplyOptionsAdapter } from "@localizer/InteractionReplyOptions";
import { LocalizableMessageActionRowAdapter } from "@localizer/MessageActionRowOptions";
import { LocalizableMessageOptionsAdapter } from "@localizer/MessageOptions";
import { Command, ContextMenuApplicationCommands, SlashApplicationCommands } from "@type/Command";
import { Dictionary } from "@type/Dictionary";
import { StealthModule } from "@type/StealthModule";
import assert from "assert-ts";
import { Client, Intents, InteractionReplyOptions, Message, MessageEditOptions, MessageEmbed, TextChannel } from "discord.js";
import { config } from "dotenv-safe";
import { readdirSync } from "fs";
import { ApplicationCommandDataResolvableAdapter } from "./adapters/ApplicationCommandDataResolvable";
import { getName } from "./Localizations";
import { injectPrototype } from "./prototype";
import { report } from "./Reporting";
import { random } from "./utils";

const client = new Client({
	intents: [
		Intents.FLAGS.GUILDS,
		Intents.FLAGS.GUILD_MESSAGES,
		Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
		Intents.FLAGS.DIRECT_MESSAGES,
		Intents.FLAGS.DIRECT_MESSAGE_REACTIONS
	]
});

const loadCommand = async (path: string) => {
	const module = await import(path);

	if (!("command" in module)) {
		throw path + ": Invalid module format";
	}

	return { path, command: module.command };
};

const loadModule = async (path: string): Promise<{ path: string, module: StealthModule }> => {
	const module = await import(path);

	if (!("module" in module)) {
		throw path + ": Invalid module format";
	}

	return { path, module: module.module };
};

try {
	config();
	injectPrototype();

	client.once("ready", async () => {
		// Error reporting
		const errorChannel = await client.channels.fetch(process.env.error_chid!) as TextChannel;
		const error = async (tag: string, e: unknown) => {
			const embed = e instanceof Error ?
				new MessageEmbed({
					title: e.name,
					fields: [
						{
							"name": "Tag",
							"value": tag,
						},
						{
							"name": "Stack",
							"value": "```\n" + e.stack + "\n```" ?? "(none)"
						}
					]
				}) :
				new MessageEmbed({
					title: "Error",
					fields: [
						{
							"name": "Tag",
							"value": tag,
						}
					]
				});

			await errorChannel.send({
				content: new Date().toISOString(),
				embeds: [embed]
			});
		};

		client.on("error", async (e) => {
			await error("client->error", e);
		});

		// Command
		const commands: Command[] = (await Promise.allSettled(readdirSync("./src/commands/")
			.filter(file => !file.startsWith("_") && file.endsWith(".ts"))
			.map(async file => await loadCommand("./commands/" + file)))
		).map((result) => {
			if (result.status === "fulfilled") {
				report("Loaded file: " + result.value.path);
				return result.value.command;
			}
			error("bot.loadCommand", "Failed to load file " + result.reason);
			return null;
		})
			.filter((command): command is Command => command !== null);

		const APICommands = commands.map(command => new ApplicationCommandDataResolvableAdapter(command).build());

		if (process.env.DEBUG) {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			for (const [_, guild] of client.guilds.cache) {
				try {
					await guild.commands.set(APICommands);
				} catch (e) {
					error("bot.setCommand", "Failed to set command for guild " + guild.name);
				}
			}
		} else {
			report("Setting global commands");
			try {
				await client.application!.commands.set(APICommands);
			} catch (e) {
				error("bot.setCommand", e);
			}
		}

		// A mapping from the source message's author id that triggered stealth modules to the replied message
		const sources: Dictionary<string> = {};

		// Linked list storing all interaction ids and it's parent, null if it's the root
		const timeouts: Dictionary<NodeJS.Timeout> = {};

		client.on("interactionCreate", async (interaction) => {
			if (!interaction.isRepliable()) return;

			const deleteButton = new LocalizableMessageActionRowAdapter([
				{
					type: "BUTTON",
					style: "DANGER",
					custom_id: "delete",
					emoji: random(0, 10) === 0 ? "🚮" : "🗑️"
				}
			]).build(interaction.getLocale());

			const reply = async (response: InteractionReplyOptions) => {
				if (response.ephemeral) {
					if (interaction.replied || interaction.deferred) {
						await interaction.editReply(response)
					} else {
						await interaction.reply(response);
					}
				} else {
					const _components = response.components?.slice();

					if (response.components) {
						response.components.push(deleteButton);
					} else {
						response.components = [deleteButton];
					}

					if (interaction.replied || interaction.deferred) {
						await interaction.editReply(response)
					} else {
						await interaction.reply(response);
					}

					// Add interaction id to linked list
					// Root level commands

					let id = interaction.id;
					const timeout = setTimeout(async () => {
						try {
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							const { components, ...x } = response;
							await interaction.editReply({ components: _components ?? [], ...x });
							delete timeouts[id];
						} catch (e) { }
					}, 1000 * 15);

					if (interaction.isApplicationCommand()) {
						timeouts[interaction.id] = timeout;
					} else if (interaction.isMessageComponent()) {
						const parent = interaction.message.interaction!.id;
						clearTimeout(timeouts[parent]);
						timeouts[parent] = timeout;
						id = parent;
					}
				}
			};

			const generalErrorReply = new LocalizableInteractionReplyOptionsAdapter({
				content: {
					key: "error"
				}
			}).build(interaction.getLocale());

			try {
				// Delete function
				if (
					interaction.isButton() && interaction.customId === "delete"
					|| interaction.isContextMenu() && interaction.command?.name === getName("delete").name
				) {
					const sourceMessage = (interaction.isContextMenu() ? interaction.getMessage() : interaction.message) as Message;

					if (sourceMessage.deletable) {
						// Check if the interaction issuer is the message author or is an admin
						const guildUser = (await interaction.guild?.members.fetch(interaction.user))!;

						if (sourceMessage.author.id !== interaction.client.user!.id) {
							await reply(
								new LocalizableInteractionReplyOptionsAdapter({
									content: {
										key: "delete.notMyMessage"
									},
									ephemeral: true
								}).build(interaction.getLocale())
							);
						}

						if (
							sources[sourceMessage.id] === interaction.user.id
							|| sourceMessage.mentions.repliedUser?.id === interaction.user.id
							|| sourceMessage.interaction && sourceMessage.interaction.user.id === interaction.user.id
							|| guildUser.permissions.has("ADMINISTRATOR")
						) {
							await sourceMessage.delete();
						} else {
							await reply(
								new LocalizableInteractionReplyOptionsAdapter({
									content: {
										key: "delete.deletingOthersMessage"
									},
									ephemeral: true
								}).build(interaction.getLocale())
							);
						}
					}
				} else if (interaction.isCommand()) {
					const command = commands.find(command => command.name === interaction.command?.name) as SlashApplicationCommands | undefined;
					assert(command !== undefined);

					if (command.defer) {
						await interaction.deferReply();
					}

					let response: InteractionReplyOptions = generalErrorReply;

					try {
						response = new LocalizableInteractionReplyOptionsAdapter(
							await command.onCommand(interaction)
						).build(interaction.getLocale());
					} catch (e) {
						error(`commands/${command.name}.onCommand`, e);
					}

					await reply(response);
				} else if (interaction.isContextMenu()) {
					const command = commands.find(command => getName(command.name).name === interaction.command?.name) as ContextMenuApplicationCommands | undefined;
					assert(command !== undefined);

					if (command.defer) {
						await interaction.deferReply();
					}
					let response: InteractionReplyOptions = {
						content: "Error..."
					};

					try {
						response = new LocalizableInteractionReplyOptionsAdapter(
							await command.onContextMenu(interaction)
						).build(interaction.getLocale());
					} catch (e) {
						error(`commands/${command.name}.onContextMenu`, e);
					}

					await reply(response);
				} else if (interaction.isMessageComponent()) {
					assert(interaction.message.interaction !== null && interaction.message.interaction !== undefined);
					const commandName = "commandName" in interaction.message.interaction ? interaction.message.interaction.commandName : interaction.message.interaction.name;

					const command = commands.find(command => getName(command.name).name === commandName) as Command | undefined;
					assert(command !== undefined);

					if (interaction.isButton() && !command.onButton) return;
					if (interaction.isSelectMenu() && !command.onSelectMenu) return;

					if (command.defer) {
						await interaction.deferUpdate();
					}

					let response: InteractionReplyOptions = generalErrorReply;

					try {
						if (interaction.isButton()) {
							response = new LocalizableInteractionReplyOptionsAdapter(
								await command.onButton!(interaction)
							).build(interaction.getLocale());
						} else if (interaction.isSelectMenu()) {
							response = new LocalizableInteractionReplyOptionsAdapter(
								await command.onSelectMenu!(interaction)
							).build(interaction.getLocale());
						}
					} catch (e) {
						error(`commands/${command.name}.${interaction.isButton()? "onButton" : "onSelectMenu"}`, e);
					}

					await reply(response);
				} else if (interaction.isModalSubmit()) {
					// TODO: Modal submit
				}
			} catch (e) {
				error("client->interactionCreate", e);
				await reply(generalErrorReply);
			}
		});

		// StealthModule
		const stealthModules: StealthModule[] = (await Promise.allSettled(readdirSync("./src/modules/")
			.filter(file => !file.startsWith("_") && file.endsWith(".ts"))
			.map(async file => await loadModule("./modules/" + file)))
		).map((result) => {
			if (result.status === "fulfilled") {
				report("Loaded file: " + result.value.path);
				return result.value.module;
			}
			error("bot.loadModule", "Failed to load file " + result.reason);
			return null;
		})
			.filter((module): module is StealthModule => module !== null);

		for (const event of ["messageCreate", "messageUpdate", "messageDelete"]) {
			client.on(event, async (message: Message) => {
				if (message.author.bot) return;

				for (const module of stealthModules.filter(module => module.event === event)) {
					let matches;

					if (module.pattern) {
						matches = message.content.match(module.pattern) ?? undefined;
						if (!matches) continue;
					}

					try {
						const _result = await module.action({
							message,
							matches
						});

						if (typeof _result === "object") {
							const deleteButton = new LocalizableMessageActionRowAdapter([
								{
									type: "BUTTON",
									style: "DANGER",
									custom_id: "delete",
									emoji: random(0, 10) === 0 ? "🚮" : "🗑️"
								}
							]).build(message.getLocale());


							const result = new LocalizableMessageOptionsAdapter(
								_result.result
							).build(message.getLocale());

							const _components = result.components?.slice() ?? [];

							result.components = result.components ? [...result.components, deleteButton] : [deleteButton];

							const msg = _result.type === "send" ? await message.channel.send(result) : await message.reply(result);

							sources[msg.id] = message.author.id;

							setTimeout(async () => {
								try {
									// eslint-disable-next-line @typescript-eslint/no-unused-vars
									const { components, ...x } = result;
									await msg.edit({
										components: _components,
										...x
									} as MessageEditOptions);
								} catch (e) { }
							}, 1000 * 15);
						} else {
							if (_result) break;
						}
					} catch (e) {
						error(`modules/${module.name}.${event}`, e);
					}
				}
			});
		}

		report(`Logged in as ${client.user!.tag}!`);
	});

	client.login(process.env.TOKEN);
} catch (e) {
	console.error("client", e);
}