import { Singleton } from "@app/Singleton";
import { enumStringKeys, req2json, round } from "@app/utils";
import { Currencies } from "@type/Database";
import { SlashCommand } from "@type/SlashCommand";
import assert from "assert";

let data = Singleton.db.data!.currency;

const worker = async () => {
	let response;
	try {
		for (let i in data) {
			const c1 = i as keyof typeof Currencies;
			for (let j in data.data[c1]) {
				const c2 = j as keyof typeof Currencies;
				response = await req2json(`https://free.currconv.com/api/v7/convert?q=${i}_${j},${j}_${i}&compact=ultra&apiKey=${process.env.currency}`);
				assert(!isNaN(response[`${i}_${j}`]) && !isNaN(response[`${j}_${i}`]));
				data.data[c1][c2] = response[`${i}_${j}`];
				data.data[c2][c1] = response[`${j}_${i}`];
			}
		}

		data.lastUpdate = new Date();
		return true;
	} catch (e) {
		return false;
	}
}

worker();
setInterval(worker, 3600 * 1000);

export const module: SlashCommand = {
	name: "currency",
	description: "Spot currency conversion",
	options: [{
		name: "source",
		description: "From what currency",
		type: "STRING",
		choices: enumStringKeys(Currencies).map(currency => ({
			name: currency,
			value: currency
		}))
	}, {
		name: "amount",
		description: "How much",
		type: "NUMBER",
		min_value: 1,
		optional: true
	}, {
		name: "target",
		description: "To what currency, defaults to all",
		type: "STRING",
		choices: enumStringKeys(Currencies).map(currency => ({
			name: currency,
			value: currency
		})),
		optional: true
	}],
	onCommand: async (interaction) => {
		const source = interaction.options.getString("source", true) as keyof typeof Currencies;
		const amount = interaction.options.getNumber("amount") ?? 1;
		const target = interaction.options.getString("target") as keyof typeof Currencies ?? null;

		return {
			embeds: [{
				title: "Convert",
				fields: [
					{
						name: source,
						value: amount.toString()
					},
					...enumStringKeys(Currencies).filter(currency => currency !== source && ((target !== null && currency === target) || target === null)).map(currency => ({
						name: currency,
						value: round(data.data[source][currency as keyof typeof Currencies] * amount, 2).toString(),
						inline: true
					}))
				],
				footer: {
					text: "Updated at"
				},
				timestamp: data.lastUpdate
			}]
		};
	}
};