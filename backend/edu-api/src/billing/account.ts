import { eq } from 'drizzle-orm';
import { createDb } from '../../db/client';
import { user } from '../../db/schema';
import { PlanSchema } from './plans';

export async function getUserPlan(env: Env, userId: string) {
	const [account] = await createDb(env.DB).select({ plan: user.plan }).from(user).where(eq(user.id, userId)).limit(1);
	if (!account) throw new Error('User not found');
	return PlanSchema.parse(account.plan);
}
