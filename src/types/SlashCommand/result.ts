import { Localizable } from "@app/localizers/Data";
import { InteractionReplyOptions } from "discord.js";
import { LocalizableMessage } from "@localizer/MessageFields";
import { Result } from "@type/Message/Result";

export type SlashCommandResultType = LocalizableMessage<InteractionReplyOptions>;

export class SlashCommandResult extends Result<InteractionReplyOptions> {
	public constructor(__result: SlashCommandResultType | Localizable, id: string) {
		super(__result);
		if (!this._result.ephemeral) this.addDeleteButton(`i${id}`)
	}
}