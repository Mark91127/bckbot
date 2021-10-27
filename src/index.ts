import { config } from "dotenv-safe";
config();

import 'module-alias/register';

import { injectPrototype } from '@app/prototype';
import { Singleton } from '@app/Singleton';
import * as utils from '@app/utils';
import { Dictionary } from '@type/Dictionary';
import { Events } from '@type/Events';
import { ArgumentRequirement, Module, ModuleActionArgument } from '@type/Module';
import { Message } from 'discord.js';
import glob from 'glob';
import { exec } from "child_process";
import { getString, i18init } from "./i18n";

injectPrototype();
i18init();

const { logger, client } = Singleton;

try {
	const startTime = new Date();
	const events = ["messageCreate", "messageDelete", "messageUpdate"];
	const eventModules: Events = utils.arr2obj(
		events,
		events.map(() => ({}))
	);

	client.on("ready", async () => {
		logger.delimiter("> ").show();

		exec('git show -s --format="v.%h on %aI"', (error, string) => {
            if (error) {
                logger.log(error.message);
            } else {
                client.user!.setActivity(string, {
					type: 'WATCHING'
				});
            }
        });

		for (let event of events) {
			// Pre-processing (init, interval)
			for (let moduleName of Object.keys(eventModules[event])) {
				const _module = eventModules[event][moduleName];
				const module = _module.module;
				let baseArgv: Dictionary<any> = {};

				if (module.init) {
					try {
						// Parallel loading
						(async () => {
							await module.init!(baseArgv);
							_module.loaded = true;
						})();
					} catch (e) {
						if (e instanceof Error)
							utils.report(
								`Init failed for module ${moduleName}: ${e.message}`
							);
					}
				} else {
					_module.loaded = true;
				}

				if (module.interval) {
					const f = async () => {
						try {
							await module.interval!.f(baseArgv);
							setTimeout(f, module.interval!.t);
						} catch (e) {
							if (e instanceof Error)
								utils.report(
									`Interval failed for module ${moduleName}: ${e.message}`
								);
						}
					};
					setTimeout(f, module.interval.t);
				}
			}
			// Build listener
			client.on(event, async (message: Message) => {
				if (message.channel.id === process.env.error_chid || message.author === client.user) return;

				let accepted = false,
					stealthExists = false,
					result;
				const messageArgs = message.content.split(" ");
				const messageTrigger = messageArgs[0].startsWith("b!") ? messageArgs[0].substr(2) : null;

				for (let _module of Object.values(eventModules[event])) {
					const module = _module.module;
					for (let trigger of module.trigger) {
						const stealth = trigger.startsWith("*");
						stealthExists = stealthExists || stealth;

						if (trigger === messageTrigger || stealth) {
							try {
								if (!_module.loaded) {
									await message.reply(
										getString(
											"index.stillLoading",
											message.getLocale()
										)
									);
									return;
								}
								let moduleActionArgument: ModuleActionArgument = {
									trigger,
									message,
								};

								if (module.argv) {
									moduleActionArgument.argv = {};
									const argNames = Object.keys(module.argv);
									// Check message argv requirements
									for (let i = 0; i < argNames.length; i++) {
										const argName = argNames[i];
										const argValue = messageArgs[i + 1]; // The first one is trigger
										if (
											module.argv[argName].includes(
												ArgumentRequirement.Required
											) &&
											typeof argValue === "undefined"
										) {
											await message.reply(
												getString(
													"index.argvError",
													message.getLocale(),
													{
														argName,
														position: i,
														trigger,
														usage: argNames
															.map((arg) => {
																const flagOptional =
																	module.argv![
																		arg
																	].includes(
																		ArgumentRequirement.Required
																	);
																const flagConcat =
																	module.argv![
																		arg
																	].includes(
																		ArgumentRequirement.Concat
																	);
																return `${flagOptional
																	? "["
																	: ""
																	}${flagConcat
																		? "..."
																		: ""
																	}${arg}${flagOptional
																		? "]"
																		: ""
																	}`;
															})
															.join(" "),
													}
												)
											);
											return;
										}
										if (argValue && argValue.length)
											moduleActionArgument.argv[argName] =
												module.argv[argName].includes(
													ArgumentRequirement.Concat
												)
													? messageArgs
														.slice(i + 1)
														.join(" ")
													: argValue;
									}
								}

								if (module.eval) {
									moduleActionArgument.eval = {};
									for (const name in module.eval) {
										moduleActionArgument.eval[name] = eval(module.eval[name]);
									}
								}

								result = await module.action(moduleActionArgument);
								if (result instanceof Message) {
									const msg = result as Message;
									const collector = msg.createReactionCollector({
										filter: (reaction, user) => {
											const flag1 = reaction.emoji.name === '🗑️';
											const flag2 = user === message.author;
											if (flag1 && !flag2 && user !== client.user) reaction.remove();
											return flag1 && flag2;
										},
										time: 15000
									});
									collector.on('collect', async () => {
										try {
											await msg.delete();
										} catch (e) { }
									});
									const reaction = await msg.react('🗑️');
									collector.on('end', async () => {
										try {
											await reaction.remove();
										} catch (e) { }
									});
								}
								if (!stealth) accepted = true;
							} catch (e) {
								if (!stealth) await message.react("❌");
								if (e instanceof Error) await utils.pmError(message, e);
							}
						}
					}
				}
				if (!accepted && message.content.startsWith("b!") && stealthExists) {
					await message.react(
						client.emojis.cache.random()
					);
					return;
				} else {
					return;
				}
			});
		}

		client.on("interactionCreate", async (interaction) => {
			const module = interaction.id.split(".")[0];

			if (interaction.isCommand()) {

			} else if (interaction.isButton()) {

			} else if (interaction.isContextMenu()) {
				
			} else if (interaction.isMessageComponent()) {
				
			} else if (interaction.isSelectMenu()) {

			}
		});
		utils.report(`Finished loading in ${+new Date() - +startTime}ms`);
	});

	glob("./bin/modules/**/*.js", async (error, fileList) => {
		if (error) throw error;
		for (let file of fileList.filter((_file) => {
			return _file.split("/").pop()![0] != "_";
		})) {
			const fileName = file.split("/").pop()!;
			const tmp = require(`@app/${file.slice(6)}`).module as Module;
			eventModules[tmp.event][fileName.slice(0, -3)] = {
				module: tmp,
				loaded: false,
			};
			utils.report(`Loaded module ${fileName}`);
		}

		await client.login(
			process.argv[2] === "dev"
				? process.env.dev_token
				: process.env.bot_token
		);
		utils.report("Logged in as " + client.user!.tag);
	});
} catch (e) {
	if (e instanceof Error)
		utils.report("Error occurred: " + e.toString());
}
