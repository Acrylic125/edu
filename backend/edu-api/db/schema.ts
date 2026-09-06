import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { TopicPlanStep } from '@edu/chat-contract';

// ─────────────────────────────────────────────
// Better Auth
// ─────────────────────────────────────────────

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		issuer: text('issuer').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', {
			mode: 'timestamp_ms',
		}),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', {
			mode: 'timestamp_ms',
		}),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [uniqueIndex('account_issuer_account_id_uidx').on(table.issuer, table.accountId)],
);

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─────────────────────────────────────────────
// Topics
// ─────────────────────────────────────────────

export const topic = sqliteTable(
	'topic',
	{
		id: text('id').primaryKey(),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		title: text('title').notNull(),

		summary: text('summary').notNull(),

		plan: text('plan', { mode: 'json' }).$type<TopicPlanStep[]>().notNull().default([]),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),

		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('topic_user_idx').on(table.userId), index('topic_user_created_idx').on(table.userId, table.createdAt)],
);

export const userCurrentTopic = sqliteTable('user_current_topic', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),

	topicId: text('topic_id')
		.notNull()
		.references(() => topic.id, { onDelete: 'cascade' }),

	part: text('part'),

	currentStepId: text('current_step_id'),

	updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

// ─────────────────────────────────────────────
// Topic Messages
// ─────────────────────────────────────────────

export const topicMessage = sqliteTable(
	'topic_message',
	{
		id: text('id').primaryKey(),

		topicId: text('topic_id')
			.notNull()
			.references(() => topic.id, { onDelete: 'cascade' }),

		role: text('role', { enum: ['user', 'assistant'] }).notNull(),

		parts: text('parts', { mode: 'json' }).notNull(),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('topic_message_topic_idx').on(table.topicId, table.createdAt)],
);

// ─────────────────────────────────────────────
// Conversation Memories
// ─────────────────────────────────────────────

export const conversationMemory = sqliteTable(
	'conversation_memory',
	{
		id: text('id').primaryKey(),

		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		topicId: text('topic_id').references(() => topic.id, {
			onDelete: 'set null',
		}),

		userMessageId: text('user_message_id').notNull(),

		agentMessageId: text('agent_message_id').notNull(),

		intent: text('intent'),

		summary: text('summary').notNull(),

		keywords: text('keywords', { mode: 'json' }).notNull(),

		imageAssetIds: text('image_asset_ids', { mode: 'json' }).notNull(),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),

		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [
		uniqueIndex('conversation_memory_user_message_uidx').on(table.userMessageId),
		index('conversation_memory_user_created_idx').on(table.userId, table.createdAt),
		index('conversation_memory_user_topic_created_idx').on(table.userId, table.topicId, table.createdAt),
	],
);

// ─────────────────────────────────────────────
// Agent Runs
// ─────────────────────────────────────────────

export const agentRun = sqliteTable(
	'agent_run',
	{
		id: text('id').primaryKey(),

		topicId: text('topic_id')
			.notNull()
			.references(() => topic.id, { onDelete: 'cascade' }),

		userMessageId: text('user_message_id')
			.notNull()
			.references(() => topicMessage.id),

		intent: text('intent'),

		status: text('status').notNull(),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),

		completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
	},
	(table) => [index('agent_run_topic_idx').on(table.topicId)],
);

// ─────────────────────────────────────────────
// Agent Steps
// ─────────────────────────────────────────────

export const agentStep = sqliteTable(
	'agent_step',
	{
		id: text('id').primaryKey(),

		runId: text('run_id')
			.notNull()
			.references(() => agentRun.id, { onDelete: 'cascade' }),

		sequence: integer('sequence').notNull(),

		type: text('type').notNull(),

		name: text('name').notNull(),

		input: text('input', { mode: 'json' }),

		output: text('output', { mode: 'json' }),

		error: text('error'),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('agent_step_run_idx').on(table.runId, table.sequence)],
);

// ─────────────────────────────────────────────
// Model Usage
// ─────────────────────────────────────────────

export const modelUsage = sqliteTable(
	'model_usage',
	{
		id: text('id').primaryKey(),

		runId: text('run_id')
			.notNull()
			.references(() => agentRun.id, { onDelete: 'cascade' }),

		stepId: text('step_id')
			.notNull()
			.references(() => agentStep.id, { onDelete: 'cascade' }),

		provider: text('provider').notNull(),

		model: text('model').notNull(),

		inputTokens: integer('input_tokens').notNull().default(0),

		outputTokens: integer('output_tokens').notNull().default(0),

		cachedInputTokens: integer('cached_input_tokens').notNull().default(0),

		reasoningTokens: integer('reasoning_tokens').notNull().default(0),

		inputPriceMicros: integer('input_price_micros'),

		outputPriceMicros: integer('output_price_micros'),

		costMicros: integer('cost_micros').notNull().default(0),
		costSource: text('cost_source', { enum: ['provider', 'unavailable'] })
			.notNull()
			.default('unavailable'),

		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('model_usage_run_idx').on(table.runId)],
);

// ─────────────────────────────────────────────
// Assets
// ─────────────────────────────────────────────

export const asset = sqliteTable(
	'asset',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		topicMessageId: text('topic_message_id').references(() => topicMessage.id, {
			onDelete: 'cascade',
		}),
		orderIndex: integer('order_index').notNull().default(0),
		storageKey: text('storage_key').notNull(),
		filename: text('filename'),
		mimeType: text('mime_type').notNull(),
		size: integer('size'),
		metadata: text('metadata', { mode: 'json' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	},
	(table) => [index('asset_user_idx').on(table.userId), index('asset_topic_message_idx').on(table.topicMessageId, table.orderIndex)],
);
