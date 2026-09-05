import { AttachmentPartSchema, OptionsPartSchema, ProposalPartSchema, TextPartSchema, type MessagePart, type Proposal } from './schema';

export function textPart(content: string) {
	return TextPartSchema.parse({ type: 'text', content });
}

export function optionsPart(labels: string[]) {
	return OptionsPartSchema.parse({
		type: 'options',
		options: labels.map((label) => ({ label })),
	});
}

export function attachmentPart(ref: string) {
	return AttachmentPartSchema.parse({ type: 'attachment', ref });
}

export function persistableParts(parts: MessagePart[]) {
	return parts.map((part) => {
		if (part.type !== 'attachment') {
			return part;
		}
		return attachmentPart(part.ref);
	});
}

export function proposalPart(proposalId: string, prompt: string, proposal: Proposal) {
	return ProposalPartSchema.parse({
		type: 'proposal',
		proposalId,
		prompt,
		proposal,
	});
}

export { partsToText } from '@edu/chat-contract';
