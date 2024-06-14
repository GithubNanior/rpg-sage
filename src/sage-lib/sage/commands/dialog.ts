import { debug } from "@rsc-utils/core-utils";
import { registerMessageListener, registerReactionListener } from "../../discord/handlers.js";
import { MessageType, ReactionType, type TCommandAndArgsAndData } from "../../discord/index.js";
import type { SageMessage } from "../model/SageMessage.js";
import type { DialogContent } from "./dialog/DialogContent.js";
import { companionChat } from "./dialog/chat/companionChat.js";
import { editChat } from "./dialog/chat/editChat.js";
import { gmChat } from "./dialog/chat/gmChat.js";
import { npcChat } from "./dialog/chat/npcChat.js";
import { pcChat } from "./dialog/chat/pcChat.js";
import { doDelete } from "./dialog/delete/doDelete.js";
import { isDelete } from "./dialog/delete/isDelete.js";
import { parseOrAutoDialogContent } from "./dialog/parseOrAutoDialog.js";
import { doPin } from "./dialog/pin/doPin.js";
import { isPin } from "./dialog/pin/isPin.js";

/** Returns the dialog content if found or null otherwise. */
async function isDialog(sageMessage: SageMessage): Promise<TCommandAndArgsAndData<DialogContent[]> | null> {
	if (!sageMessage.allowDialog) {
		return null;
	}

	const dialogContents = parseOrAutoDialogContent(sageMessage);
	if (!dialogContents?.length) {
		return null;
	}

	return {
		command: dialogContents.map(d => d.type).join("+"),
		// args: undefined,
		data: dialogContents
	};
}

async function doDialog(sageMessage: SageMessage, dialogContents: DialogContent[]): Promise<void> {
	// we attach the image the first dialog that has (attachment) as an argument, otherwise the first of all dialogs
	const attachmentIndex = Math.max(dialogContents.findIndex(dialogContent => dialogContent.attachment === true), 0);
	for (let index = 0; index < dialogContents.length; index++) {
		const dialogContent = dialogContents[index];
		const options = { skipDelete:index > 0, doAttachment:index === attachmentIndex };
		switch (dialogContent.type) {
			case "npc": case "enemy": case "ally": case "boss": case "minion":
				await npcChat(sageMessage, dialogContent, options);
				break;
			case "gm":
				await gmChat(sageMessage, dialogContent, options);
				break;
			case "pc":
				await pcChat(sageMessage, dialogContent, options);
				break;
			case "alt": case "companion": case "familiar": case "hireling":
				await companionChat(sageMessage, dialogContent, options);
				break;
			case "edit":
				await editChat(sageMessage, dialogContent);
				break;
			default:
				debug(`Invalid dialogContent.type:`, dialogContent);
				break;
		}
	}
}

export function registerDialog(): void {
	registerMessageListener(isDialog, doDialog, { type:MessageType.Both, priorityIndex:0 });
	registerReactionListener(isDelete, doDelete, { type:ReactionType.Add });
	registerReactionListener(isPin, doPin);
}
