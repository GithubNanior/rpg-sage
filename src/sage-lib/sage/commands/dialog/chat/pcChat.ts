import { ColorType } from "../../../model/HasColorsCore";
import type { SageMessage } from "../../../model/SageMessage";
import type { DialogContent } from "../DialogContent";
import { findPc } from "../find/findPc";
import type { ChatOptions } from "./ChatOptions";
import { doChat } from "./doChat";

export async function pcChat(sageMessage: SageMessage, dialogContent: DialogContent, options: ChatOptions): Promise<void> {
	const findOpts = { auto:true, first:true };
	let character = findPc(sageMessage, dialogContent.name, findOpts);

	// this logic allows for dyanmic display names; without it things get weird
	if (!character && dialogContent.displayName) {
		character = findPc(sageMessage, `${dialogContent.name} (${dialogContent.displayName})`, findOpts);
		if (character) dialogContent.displayName = undefined;
	}

	if (character) {
		await doChat(sageMessage, { character, colorType:ColorType.PlayerCharacter, dialogContent }, options);
	}else {
		await sageMessage.reactWarn(`Unable to find PC for dialog: "${dialogContent.name ?? ""}"`);
	}
}