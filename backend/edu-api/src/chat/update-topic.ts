import type { Db } from '../../db/client';
import { type TopicUpdate } from '../agents/parsed-output';
import { type AgentContext } from './context';
import { optionLabel, shortFocus } from './option-label';
import { learningStepsFromPlan } from './new-topic';
import { optionsPart, planPart, textPart } from '../messages/parts';
import { updateCurrentPart, updateCurrentStep, updateTopicState } from '../topics/repository';

export async function applyTopicUpdate(db: Db, context: AgentContext, topicId: string, update: TopicUpdate) {
	const resultingPlan = update.plan
		? learningStepsFromPlan(update.plan, update.title ?? context.topic?.title ?? '')
		: context.topic?.plan ?? [];
	let effectiveCurrentStep = resultingPlan.find((step) => step.id === context.topic?.currentStepId);
	const normalizedPart = update.part ? shortFocus(update.part).toLowerCase() : null;
	let matchingStep = resultingPlan.find((item) => {
		const label = item.label.toLowerCase();
		return label === update.part?.toLowerCase() || shortFocus(item.label).toLowerCase() === normalizedPart;
	});
	if (!matchingStep && update.part) {
		const sectionNumber = /^\d+$/.exec(update.part)?.[0];
		if (sectionNumber) matchingStep = resultingPlan[Number(sectionNumber) - 1];
	}

	const topicUpdates: { title?: string; summary?: string; plan?: TopicUpdate['plan'] } = {};
	if (update.title) {
		topicUpdates.title = update.title;
	}
	if (update.summary) {
		topicUpdates.summary = update.summary;
	}
	if (update.plan) {
		topicUpdates.plan = resultingPlan;
	}

	if (Object.keys(topicUpdates).length > 0) {
		await updateTopicState(db, topicId, topicUpdates);
	}

	if (update.part) {
		const nextPart = matchingStep?.label ?? shortFocus(update.part);
		await updateCurrentPart(db, context.userId, shortFocus(nextPart), topicId);
		if (matchingStep) {
			effectiveCurrentStep = matchingStep;
			await updateCurrentStep(db, context.userId, topicId, matchingStep.id);
		}
	} else if (update.plan && !effectiveCurrentStep) {
		const fallback = resultingPlan.find((step) => step.parent === null) ?? resultingPlan[0];
		if (fallback) {
			effectiveCurrentStep = fallback;
			await updateCurrentPart(db, context.userId, shortFocus(fallback.label), topicId);
			await updateCurrentStep(db, context.userId, topicId, fallback.id);
		}
	}

	const part = shortFocus(update.part ?? context.topic?.part ?? 'the current topic');
	const title = shortFocus(update.title ?? context.topic?.title ?? 'this topic');
	const optionPart = effectiveCurrentStep?.label ?? matchingStep?.label ?? context.topic?.part ?? part;
	let confirmation = 'Learning focus updated!';
	if (Object.keys(topicUpdates).length > 0) confirmation = 'Learning plan updated!';
	else if (matchingStep) confirmation = 'Current step changed!';
	confirmation += ` You are currently on ${optionPart}.`;

	return {
		parts: [
			textPart(confirmation),
			...(resultingPlan.length > 0 ? [planPart(resultingPlan)] : []),
			optionsPart([optionLabel("What's", optionPart) + '?', optionLabel('Test me on', title)]),
		],
	};
}
