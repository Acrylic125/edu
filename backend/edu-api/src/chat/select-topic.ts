import type { Db } from "../../db/client";
import { getTopicForUser, setCurrentTopic } from "../topics/repository";

export async function selectTopic(
	db: Db,
	userId: string,
	topicId: string,
): Promise<{ success: boolean; error?: string }> {
	const topic = await getTopicForUser(db, topicId, userId);

	if (!topic) {
		return { success: false, error: "Topic not found" };
	}

	await setCurrentTopic(db, userId, topicId, null);

	return { success: true };
}
