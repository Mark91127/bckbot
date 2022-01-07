import { Localizable } from "@localizer/Data";
import { LocalizableMessage } from "@localizer/MessageFields";
import { Result } from "@type/Message/Result";
import { MessageOptions } from "discord.js";

export type StealthModuleResultType = LocalizableMessage<MessageOptions>;

export class StealthModuleResult extends Result<MessageOptions>{
	public constructor(__result: Localizable | StealthModuleResultType, id: string) {
		super(__result);
		this.addDeleteButton(`m${id}`);
	}
}