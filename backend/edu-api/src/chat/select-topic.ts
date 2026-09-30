import type { Db } from "../../db/client";
import {
	getTopicForUser,
	getCurrentTopic,
	setCurrentTopic,
	updateCurrentStep,
} from "../topics/repository";

export async function selectTopic(
	db: Db,
	userId: string,
	topicId: string,
): Promise<{ success: boolean; error?: string }> {
	const topic = await getTopicForUser(db, topicId, userId);

	if (!topic) {
		return { success: false, error: "Topic not found" };
	}

	const current = await getCurrentTopic(db, userId);
	if (current?.topic.id !== topicId) {
		await setCurrentTopic(db, userId, topicId, null);
	}

	return { success: true };
}

export async function selectTopicStep(
	db: Db,
	userId: string,
	topicId: string,
	stepId: string,
): Promise<{ success: boolean; error?: string }> {
	const topic = await getTopicForUser(db, topicId, userId);

	if (!topic) {
		return { success: false, error: "Topic not found" };
	}

	if (!topic.plan.some((step) => step.id === stepId)) {
		return { success: false, error: "Plan step not found" };
	}

	await updateCurrentStep(db, userId, topicId, stepId);

	return { success: true };
}
