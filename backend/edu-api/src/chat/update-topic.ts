import type { Db } from '../../db/client';
import { type TopicUpdate } from '../agents/parsed-output';
import { type AgentContext } from './context';
import { optionLabel, shortFocus } from './option-label';
import { optionsPart, textPart } from '../messages/parts';
import { updateCurrentPart, updateCurrentStep, updateTopicState } from '../topics/repository';

export async function applyTopicUpdate(db: Db, context: AgentContext, topicId: string, update: TopicUpdate) {
	const normalizedPart = update.part ? shortFocus(update.part).toLowerCase() : null;
	let matchingStep = context.topic?.plan?.find((item) => {
		const label = item.label.toLowerCase();
		return label === update.part?.toLowerCase() || shortFocus(item.label).toLowerCase() === normalizedPart;
	});
	if (!matchingStep && context.topic?.plan && update.part) {
		const sectionNumber = /^\d+$/.exec(update.part)?.[0];
		if (sectionNumber) matchingStep = context.topic.plan[Number(sectionNumber) - 1];
	}

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
		const nextPart = matchingStep?.label ?? shortFocus(update.part);
		await updateCurrentPart(db, context.userId, shortFocus(nextPart), topicId);
		if (matchingStep) await updateCurrentStep(db, context.userId, topicId, matchingStep.id);
	}

	const part = shortFocus(update.part ?? context.topic?.part ?? 'the current topic');
	const title = shortFocus(update.title ?? context.topic?.title ?? 'this topic');
	const currentStepId = context.topic?.currentStepId;
	const currentStep = context.topic?.plan?.find((item) => item.id === currentStepId);
	const optionPart = matchingStep?.label ?? currentStep?.label ?? context.topic?.part ?? part;

	return {
		parts: [textPart('Learning plan updated!'), optionsPart([optionLabel("What's", optionPart) + '?', optionLabel('Test me on', title)])],
	};
}
