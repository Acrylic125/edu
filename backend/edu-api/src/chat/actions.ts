import type { Db } from '../../db/client';
import type { AgentRunner } from '../agents/runner';
import type { AgentContext } from './context';
import type { ChatRunIo } from './route';
import type { Proposal, ChatRequest } from '../messages/schema';
import { linkAssetsToMessage } from '../assets/repository';
import { createTopicMessage, reassignTopicMessage } from '../messages/persistence';
import { textPart, optionsPart, planPart } from '../messages/parts';
import { createTopic, setCurrentTopic } from '../topics/repository';
import { shortFocus, optionLabel } from './option-label';
import { formatTopicPlanMarkdown } from './new-topic';
import { applyTopicUpdate } from './update-topic';
export async function acceptProposal(
	db: Db,
	runner: AgentRunner,
	context: AgentContext,
	io: ChatRunIo,
	proposal: Proposal,
	request: ChatRequest,
) {
	io.signal.throwIfAborted();
	switch (proposal.kind) {
		case 'create-topic': {
			const plan = proposal.plan ?? [{ id: 'focus', label: proposal.part, summary: proposal.summary, parent: null }];
			let part = shortFocus(proposal.part);
			if (proposal.legacyPlan) {
				const suppliedContext = proposal.legacyPlan.find(
					(item) => item.role !== 'section' && shortFocus(item.title).toLowerCase() === part.toLowerCase(),
				);
				const firstSection = proposal.legacyPlan.find((item) => item.role === 'section' && item.depth === 0);
				if (suppliedContext && firstSection) part = shortFocus(firstSection.title);
			} else if (proposal.plan) {
				const matchingStep = proposal.plan.find((step) => shortFocus(step.label).toLowerCase() === part.toLowerCase());
				const firstRootStep = proposal.plan.find((step) => step.parent === null);
				if (!matchingStep && firstRootStep) part = shortFocus(firstRootStep.label);
			}
			const currentStep = plan.find((step) => shortFocus(step.label).toLowerCase() === part.toLowerCase());
			const topic = await createTopic(db, {
				userId: context.userId,
				title: proposal.title,
				summary: proposal.summary,
				part,
				plan,
			});
			await setCurrentTopic(db, context.userId, topic.id, part, currentStep?.id ?? plan[0]?.id ?? null);
			if (context.topic) {
				await reassignTopicMessage(db, request.messageId, context.topic.id, topic.id);
			} else {
				await createTopicMessage(db, { id: request.messageId, topicId: topic.id, role: 'user', parts: request.parts });
				await linkAssetsToMessage(db, { userId: context.userId, messageId: request.messageId, parts: request.parts });
				if (io.userMessageId !== request.messageId)
					await createTopicMessage(db, {
						id: io.userMessageId,
						topicId: topic.id,
						role: 'user',
						parts: [textPart('Confirm')],
					});
			}

			const planText = proposal.legacyPlan
				? formatTopicPlanMarkdown(proposal.legacyPlan, true)
				: formatTopicPlanMarkdown(plan);
			io.onDelta(0, planText);
			let optionLabels = [optionLabel("What's", proposal.part) + '?', optionLabel('Test me on', proposal.title)];
			if (proposal.plan) {
				optionLabels = [optionLabel('Explain', part), optionLabel('Practice', part)];
			}
			const parts = [textPart(planText), planPart(plan), optionsPart(optionLabels)];
			return {
				parts,
				committed: true as const,
				topicId: topic.id,
				pendingProposal: null,
			};
		}
		case 'update-topic': {
			if (!context.topic) {
				return {
					parts: [textPart('Start a topic with /new first.')],
					topicId: undefined,
					pendingProposal: null,
				};
			}
			const applied = await applyTopicUpdate(db, context, context.topic.id, {
				title: proposal.title,
				summary: proposal.summary,
				part: proposal.part,
			});
			io.onDelta(0, 'Learning plan updated!');
			return {
				parts: applied.parts,
				committed: true as const,
				topicId: context.topic.id,
				pendingProposal: null,
			};
		}
		default: {
			const _exhaustive: never = proposal;
			return _exhaustive;
		}
	}
}
