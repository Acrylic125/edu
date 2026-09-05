import type { Db } from '../../db/client';
import { type TopicUpdate } from '../agents/parsed-output';
import { type AgentContext } from './context';
import { optionLabel, shortFocus } from './option-label';
import { optionsPart, textPart } from '../messages/parts';
import { updateCurrentPart, updateTopicState } from '../topics/repository';

export async function applyTopicUpdate(db: Db, context: AgentContext, topicId: string, update: TopicUpdate) {
	const topicUpdates: { title?: string; summary?: string } = {};
	if (update.title) {
		topicUpdates.title = update.title;
	}
	if (update.summary) {
		topicUpdates.summary = update.summary;
	}

	if (Object.keys(topicUpdates).length > 0) {
		await updateTopicState(db, topicId, topicUpdates);
	}

	if (update.part) {
		await updateCurrentPart(db, context.userId, shortFocus(update.part), topicId);
	}

	const part = shortFocus(update.part ?? context.topic?.part ?? 'the current topic');
	const title = shortFocus(update.title ?? context.topic?.title ?? 'this topic');

	return {
		parts: [textPart('Learning plan updated!'), optionsPart([optionLabel("What's", part) + '?', optionLabel('Test me on', title)])],
	};
}
