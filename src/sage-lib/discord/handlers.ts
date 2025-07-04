import { error, isNullOrUndefined, verbose, warn, type Optional, type Snowflake } from "@rsc-utils/core-utils";
import { fetchIfPartial, toHumanReadable, type DInteraction, type MessageOrPartial, type ReactionOrPartial, type UserOrPartial } from "@rsc-utils/discord-utils";
import { ChannelType, MessageType as DMessageType, GatewayIntentBits, IntentsBitField, Partials, PermissionFlagsBits, type Channel, type Interaction } from "discord.js";
import { SageInteraction } from "../sage/model/SageInteraction.js";
import { SageMessage } from "../sage/model/SageMessage.js";
import { SageReaction } from "../sage/model/SageReaction.js";
import { isDeleted } from "./deletedMessages.js";
import { MessageType, ReactionType } from "./enums.js";
import type { TCommandAndArgsAndData, TCommandAndData, THandlerOutput, TInteractionHandler, TInteractionTester, TMessageHandler, TMessageTester, TReactionHandler, TReactionTester } from "./types.js";

//#region helpers

/**
 * We only call a handler if the tester returns a value other than: undefined, null, false
 * @param object
 */
function isActionableObject<T>(object: T | null | undefined | false): object is T {
	return object !== null && object !== undefined && object !== false;
}

/**
 * If the listener's type isn't Both, confirm that it matches the current MessageType or ReactionType
 * @param listener
 * @param type
 */
function isActionableType(listener: TMessageListener, type: MessageType): boolean;
function isActionableType(listener: TReactionListener, type: ReactionType): boolean;
function isActionableType(listener: TMessageListener | TReactionListener, type: MessageType | ReactionType): boolean {
	return !listener.type || listener.type === type;
}

//#endregion

//#region listeners

type PermFlagBitsKeys = keyof typeof PermissionFlagsBits;

type TListener = {
	command: string;
	intents?: GatewayIntentBits[];
	permissions?: PermFlagBitsKeys[];
	priorityIndex?: number;
	which: TListenerTypeName;
};

type TInteractionType = undefined;
type TInteractionListener = TListener & {
	tester: TInteractionTester;
	handler: TInteractionHandler;
	type?: TInteractionType;
	which: "InteractionListener";
};
const interactionListeners: TInteractionListener[] = [];

type TMessageListener = TListener & {
	tester: TMessageTester;
	handler: TMessageHandler;
	regex?: RegExp;
	type: MessageType;
	which: "MessageListener";
};
const messageListeners: TMessageListener[] = [];

type TReactionListener = TListener & {
	tester: TReactionTester;
	handler: TReactionHandler;
	type: ReactionType;
	which: "ReactionListener";
};
const reactionListeners: TReactionListener[] = [];

type TListenerType = TInteractionListener | TMessageListener | TReactionListener;
function getListeners<T extends TListenerType>(which: TListenerTypeName): T[] {
	switch(which) {
		case "InteractionListener": return interactionListeners as T[];
		case "MessageListener": return messageListeners as T[];
		case "ReactionListener": return reactionListeners as T[];
		default: return [];
	}
}

type TListenerTypeName = "InteractionListener" | "MessageListener" | "ReactionListener";
function registerListener<T extends TListenerType>(listener: T): void {
	const listeners: T[] = getListeners(listener.which);

	if (isNullOrUndefined(listener.priorityIndex)) {
		verbose(`Registering ${listener.which} #${listeners.length + 1}: ${listener.command ?? listener.tester.name}`);
	} else {
		verbose(`Registering ${listener.which} #${listeners.length + 1} at priorityIndex ${listener.priorityIndex}: ${listener.command ?? listener.tester.name}`);
		if (listeners.find(l => l.priorityIndex === listener.priorityIndex)) {
			warn(`${listener.which} at priorityIndex ${listener.priorityIndex} already exists!`);
		}
	}

	if (listener.which === "MessageListener" && listeners.some(l => l.command === listener.command)) {
		warn(`${listener.which} command ${listener.command} already exists!`);
	}

	listeners.push(listener);

	listeners.sort((a, b) => {
		// we want to check priority first, lower priority means lower index means first checked
		const aPriority = a.priorityIndex ?? 999;
		const bPriority = b.priorityIndex ?? 999;
		if (aPriority < bPriority) {
			return -1;
		}else if (aPriority > bPriority) {
			return 1;
		}

		// we check command length next, make longer commands a lower index to check them before shorter commands
		const aCmdLength = a.command.length ?? 0;
		const bCmdLength = b.command.length ?? 0;
		if (aCmdLength < bCmdLength) {
			return 1;
		}else if (aCmdLength > bCmdLength) {
			return -1;
		}

		// sort by command text last, for funsies
		if (a.command < b.command) {
			return -1;
		}else if (a.command > b.command) {
			return 1;
		}

		return 0;
	});
}

type RegisterOptions = {
	command?: string;
	intents?: GatewayIntentBits[];
	permissions?: PermFlagBitsKeys[];
	priorityIndex?: number;
};
type RegisterInteractionOptions = RegisterOptions & { type?: TInteractionType; };
type RegisterMessageOptions = RegisterOptions & { type?: MessageType; };
type RegisterReactionOptions = RegisterOptions & { type?: ReactionType; };

export function registerInteractionListener(tester: TInteractionTester, handler: TInteractionHandler, { type, command, ...options }: RegisterInteractionOptions = { }): void {
	command = (command ?? tester.name ?? handler.name).trim();
	registerListener({ which:"InteractionListener", tester, handler, type, command, ...options });
}

export function registerMessageListener(tester: TMessageTester, handler: TMessageHandler, { type = MessageType.Post, command, ...options }: RegisterMessageOptions = { }): void {
	command = (command ?? tester.name ?? handler.name).trim();
	const keyRegex = command.toLowerCase().replace(/[-\s]+/g, "[\\-\\s]*");
	const regex = RegExp(`^${keyRegex}(?:$|(\\s+(?:.|\\n)*?)$)`, "i");
	registerListener({ which:"MessageListener", tester, handler, type, command, regex, ...options });
}

export function registerReactionListener<T>(tester: TReactionTester<T>, handler: TReactionHandler<T>, { type = ReactionType.Both, command, ...options }: RegisterReactionOptions = { }): void {
	command = (command ?? tester.name ?? handler.name).trim();
	registerListener({ which:"ReactionListener", tester, handler, type, command, ...options });
}

export function getRegisteredIntents() {
	// const registered: IntentsString[] = [];
	// messageListeners.forEach(listener => registered.push(...listener.intents ?? []));
	// reactionListeners.forEach(listener => registered.push(...listener.intents ?? []));

	return [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMembers,
		IntentsBitField.Flags.GuildModeration,
		// IntentsBitField.Flags.GuildBans <-- deprecated
		IntentsBitField.Flags.GuildEmojisAndStickers,
		// IntentsBitField.Flags.GuildIntegrations
		IntentsBitField.Flags.GuildWebhooks,
		IntentsBitField.Flags.GuildInvites,
		// IntentsBitField.Flags.GuildVoiceStates,
		IntentsBitField.Flags.GuildPresences,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.GuildMessageReactions,
		// IntentsBitField.Flags.GuildMessageTyping,
		IntentsBitField.Flags.DirectMessages,
		IntentsBitField.Flags.DirectMessageReactions,
		// IntentsBitField.Flags.DirectMessageTyping,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.GuildScheduledEvents,
		// IntentsBitField.Flags.AutoModerationConfiguration,
		// IntentsBitField.Flags.AutoModerationExecution,
		IntentsBitField.Flags.GuildMessagePolls,
		IntentsBitField.Flags.DirectMessagePolls,
	];
}

export function getRegisteredPartials() {
	return [
		// Partials.GuildMember, // guild member updates
		Partials.Message,        // message update, reaction add/remove
		Partials.Reaction,       // reaction add/remove
		// Partials.User            // reaction add/remove
	];
}

//#endregion

//#region interactions

type InteractionFlags = {
	canHandle?: boolean;
	canIgnore?: boolean;
	invalidInteraction?: boolean;
	isAnySelectMenu?: boolean;
	isButton?: boolean;
	isCommand?: boolean;
	isMessageComponent?: boolean;
	isMessageContextMenuCommand?: boolean;
	isModalSubmit?: boolean;
	isUserContextMenuCommand?: boolean;
}
function getInteractionFlags(interaction: Optional<Interaction>): InteractionFlags {
	if (!interaction) {
		return { canIgnore:true, invalidInteraction:true };
	}

	if (isChannelWeCanIgnore(interaction?.channel)) {
		return { canIgnore:true };
	}

	const ret = (key: keyof InteractionFlags) => {
		const flags: InteractionFlags = { canIgnore:false, canHandle:true };
		flags[key] = true;
		return flags;
	};

	try {
		const keys = ["isAnySelectMenu", "isButton", "isCommand", "isMessageComponent", "isMessageContextMenuCommand", "isModalSubmit"] as (keyof Interaction & ("isAnySelectMenu" | "isButton" | "isCommand" | "isMessageComponent" | "isMessageContextMenuCommand" | "isModalSubmit" | "isMessageContextMenuCommand"))[];
		//, "isUserContextMenuCommand"
		for (const key of keys) {
			if (interaction[key]()) {
				return ret(key);
			}
		}
	}catch(ex) {
		error(toHumanReadable(interaction.user) ?? "@UnknownInteractionUser", interaction.toJSON(), ex);
	}

	return { canIgnore:false, canHandle:false };
}

export async function handleInteraction(interaction: Interaction): Promise<THandlerOutput> {
	const output = { tested: 0, handled: 0 };

	const flags = getInteractionFlags(interaction);
	if (flags.canHandle) {
		try {
			const sageInteraction = await SageInteraction.fromInteraction(interaction as DInteraction);
			await handleInteractions(sageInteraction, output);
			sageInteraction.clear();
		}catch(ex) {
			error(toHumanReadable(interaction.user) ?? "Unknown User", interaction.toJSON(), ex);
		}
		if (!output.handled) {
			error({
				ev: "Unhandled Interaction",
				guild: interaction.guild?.name,
				customId: "customId" in interaction ? interaction.customId : undefined,
				user: toHumanReadable(interaction.member?.user ?? interaction.user),
				json: "customId" in interaction ? undefined : interaction.toJSON(),
				...flags
			});
		}
	}

	return output;
}

async function handleInteractions(sageInteraction: SageInteraction<any>, output: THandlerOutput): Promise<void> {
	for (const listener of interactionListeners) {
		// check if isActionableType here?
		const clonedInteraction = sageInteraction.clone();
		const data = await listener.tester(clonedInteraction);
		output.tested++;
		if (isActionableObject(data)) {
			await listener.handler(clonedInteraction, data);
			output.handled++;
			break;
		}
	}

}

//#endregion

// #region messages

/** Performs various checks of the content for embed urls. */
function checkContentForUrls(content: string | null, urls: (string | null)[]) {
	if (content) {
		return urls.every(url => {
			if (url) {
				if (content.includes(url)) {
					return true;
				}
				// discord did something funky, recently, that i just notice (2024-03-07) ... adding %22 at the end of embed urls ...
				if (url.endsWith("%22") && content.includes(url.replace(/%22$/, ""))) {
					return true;
				}
			}
			return false;
		});
	}
	return false;
}

/**
 * Discord edits posts with urls to add image and summary information as embeds.
 * We are already responding to the original, so we should ignore the edits.
 * 1. ignore image embeds
 * @param botTesterMessage
 */
function isEditWeCanIgnore(message: MessageOrPartial, originalMessage: Optional<MessageOrPartial>): boolean {
	if (!originalMessage) {
		return false;
	}

	// Embedding images and website cards don't change the message content
	const matchingContent = originalMessage.content === message.content;

	// The new message should have more embeds than the original
	const moreEmbedLengths = originalMessage.embeds.length < message.embeds.length;

	// the first of the new embeds
	const newEmbedIndex = originalMessage.embeds.length;

	// If an embed's url is in the content, the edit was simply to create the embed
	const contentIncludesUrls = checkContentForUrls(message.content, message.embeds.slice(newEmbedIndex).map(embed => embed.url));

	return matchingContent && moreEmbedLengths && contentIncludesUrls;
}

/** We don't want to process actions in announcement channels/threads nor in categories (not sure that is even possible, though). */
function isChannelWeCanIgnore(channel: Optional<Channel>): boolean {
	return [ChannelType.AnnouncementThread, ChannelType.GuildAnnouncement, ChannelType.GuildCategory].includes(channel?.type!);
}

/** We don't want to process actions by bots or system messages. */
function isUserWeCanIgnore(user: Optional<UserOrPartial>): boolean {
	return user?.bot || user?.system ? true : false;
}

/**
 * Discord has a lot of message types.
 * We only want to respond to default messages and replies.
 * We also want to exclude:
 * - system messages (system, author.system)
 * - messages from other bots (webhookId, author.bot).
 * - deleted messages (isDeleted)
 */
function isMessageWeCanIgnore(message: MessageOrPartial): boolean {
// function isMessageWeCanIgnore(message: MessageOrPartial, _originalMessage: Optional<MessageOrPartial>): boolean {
	const { id, system, type, webhookId } = message;
	return system || !!webhookId
		|| isDeleted(id as Snowflake)
		|| (type !== null ? ![DMessageType.Default, DMessageType.Reply].includes(type) : false);
}

/** Combines all the is_X_WeCanIgnore methods for reuse. */
function canIgnoreMessage(message: MessageOrPartial, originalMessage: Optional<MessageOrPartial>): boolean {
	return isUserWeCanIgnore(message.author)
	|| isChannelWeCanIgnore(message.channel)
	|| isMessageWeCanIgnore(message)
	|| isEditWeCanIgnore(message, originalMessage);
}

export async function handleMessage(message: MessageOrPartial, originalMessage: Optional<MessageOrPartial>, messageType: MessageType): Promise<THandlerOutput> {
	const output = { tested: 0, handled: 0 };

	try {
		// can we ignore it without fetching?
		let canIgnore = canIgnoreMessage(message, originalMessage);
		if (!canIgnore) {
			// save partial so we know to recheck canIgnoreMessage after a fetch
			const wasPartial = message.partial;

			// fetch it just in case
			const fetchedMessage = await fetchIfPartial(message);

			// recheck a previously partial message
			canIgnore = wasPartial && fetchedMessage ? canIgnoreMessage(fetchedMessage, originalMessage) : false;

			// process the message
			if (!canIgnore && fetchedMessage) {
				const sageMessage = await SageMessage.fromMessage(fetchedMessage);
				await handleMessages(sageMessage, messageType, output);
				sageMessage.clear();
			}
		}
	} catch (ex) {
		error(toHumanReadable(message.author) ?? "Unknown User", `\`${message.content}\``, ex);
	}

	return output;
}

async function handleMessages(sageMessage: SageMessage, messageType: MessageType, output: THandlerOutput): Promise<void> {
	for (const listener of messageListeners) {
		if (isActionableType(listener, messageType)) {
			const clonedMessage = sageMessage.clone();
			const commandAndArgsAndData = <TCommandAndArgsAndData<any>>await listener.tester(clonedMessage);
			output.tested++;
			if (isActionableObject(commandAndArgsAndData)) {
				clonedMessage.setCommandAndArgs(commandAndArgsAndData);
				await listener.handler(clonedMessage, commandAndArgsAndData.data);
				output.handled++;
				break;
			}
		}
	}
	// track incorrect command attempts that aren't edits
	if (!output.handled && messageType !== MessageType.Edit && sageMessage.hasPrefix && sageMessage.prefix && /^!!?/.test(sageMessage.slicedContent)) {
		error(`I got ${messageListeners.length} message handlers, but "${sageMessage.slicedContent}" ain't one!`);
	}
}

// #endregion messages

// #region reactions

/** Returns the number of handlers executed. */
export async function handleReaction(messageReaction: ReactionOrPartial, user: UserOrPartial, reactionType: ReactionType): Promise<THandlerOutput> {
	const output = { tested: 0, handled: 0 };

	const canIgnore = isUserWeCanIgnore(user)
		|| isChannelWeCanIgnore(messageReaction.message.channel);

	if (canIgnore) {
		return output;
	}

	try {
		let sageReaction: SageReaction | undefined;

		for (const listener of reactionListeners) {
			if (!isActionableType(listener, reactionType)) continue;

			if (!sageReaction) sageReaction = await SageReaction.fromMessageReaction(messageReaction, user, reactionType);

			const commandAndData = await listener.tester(sageReaction) as TCommandAndData<any>;
			output.tested++;

			if (isActionableObject(commandAndData)) {
				sageReaction.command = commandAndData.command;
				await listener.handler(sageReaction, commandAndData.data);
				output.handled++;
				break;
			}
		}

		sageReaction?.clear();

	} catch (ex) {
		error(toHumanReadable(user), `\`${messageReaction.emoji.name}\``, ex);
	}

	return output;
}

// #endregion Reaction Handling
