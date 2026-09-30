import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { getCurrentTopic, getTopicForUser } from './topics/repository';
import type { loadAllMessages } from './messages/persistence';

const mocks = vi.hoisted(() => ({
  getCurrentTopic: vi.fn<typeof getCurrentTopic>(),
  getTopicForUser: vi.fn<typeof getTopicForUser>(),
  loadAllMessages: vi.fn<typeof loadAllMessages>(),
  setCurrentTopic: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('./do/chat', () => ({ ChatDurableObject: class {}, EDU_USER_ID_HEADER: 'user', EDU_SESSION_EXPIRES_HEADER: 'expires' }));
vi.mock('../db/client', () => ({ createDb: () => ({}) }));
vi.mock('./lib/auth-middleware', () => ({ requireUser: mocks.requireUser }));
vi.mock('./assets/http', () => ({ handleAssetRequest: async () => null }));
vi.mock('./assets/load', () => ({ hydrateAttachmentParts: async (_env: Env, _db: object, _userId: string, parts: object[]) => parts }));
vi.mock('./topics/repository', () => ({
  getCurrentTopic: mocks.getCurrentTopic, getTopicForUser: mocks.getTopicForUser,
  setCurrentTopic: mocks.setCurrentTopic, listUserTopics: vi.fn(),
  updateCurrentPart: vi.fn(), updateCurrentStep: vi.fn(), updateTopicState: vi.fn(),
}));
vi.mock('./topics/document', () => ({ getTopicDocument: async () => ({ markdown: 'Notes', updatedAt: '2026-09-30T00:00:00.000Z' }), saveTopicDocument: vi.fn() }));
vi.mock('./messages/persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./messages/persistence')>(),
  loadAllMessages: mocks.loadAllMessages,
}));
vi.mock('./chat/new-topic', () => ({ learningStepsFromPlan: vi.fn() }));
vi.mock('./documents/pdf', () => ({ indexPdfBatch: vi.fn() }));

import worker from './index';

const topic = {
  id: 'topic_requested', userId: 'user_fixture', title: 'Requested chat', summary: '', plan: [],
  createdAt: new Date('2026-09-30'), updatedAt: new Date('2026-09-30'),
};
const env = { WEB_ORIGIN: 'http://web.test', DB: {} } as Env;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ userId: topic.userId, expiresAt: Date.now() + 60_000 });
  mocks.getCurrentTopic.mockResolvedValue({ topic: { ...topic, id: 'topic_other' }, part: 'Other', currentStepId: 'other-step' });
  mocks.getTopicForUser.mockResolvedValue(topic);
  mocks.loadAllMessages.mockResolvedValue([]);
});

async function request(path: string, method = 'GET') {
  return worker.fetch(new Request(`http://api.test${path}`, { method }), env);
}

describe('chat messages by URL', () => {
  it('reads the requested topic without changing the global selection', async () => {
    const response = await request('/topics/topic_requested/messages');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ topic: { id: topic.id, part: null, currentStepId: null }, messages: [] });
    expect(mocks.getTopicForUser).toHaveBeenCalledWith({}, topic.id, topic.userId);
    expect(mocks.loadAllMessages).toHaveBeenCalledWith({}, topic.id);
    expect(mocks.setCurrentTopic).not.toHaveBeenCalled();
  });

  it('returns 404 before loading messages for another user or missing topic', async () => {
    mocks.getTopicForUser.mockResolvedValue(null);
    const response = await request('/topics/topic_private/messages');
    expect(response.status).toBe(404);
    expect(mocks.loadAllMessages).not.toHaveBeenCalled();
  });

  it('preserves the selected plan step when reading the current chat by ID', async () => {
    mocks.getCurrentTopic.mockResolvedValue({ topic, part: 'Binary', currentStepId: 'step-binary' });
    const response = await request('/topics/topic_requested/messages');
    expect(await response.json()).toMatchObject({ topic: { id: topic.id, part: 'Binary', currentStepId: 'step-binary' } });
  });

  it('keeps the legacy current-messages endpoint working', async () => {
    const response = await request('/topics/current/messages');
    expect(await response.json()).toMatchObject({ topic: { id: 'topic_other' } });
    expect(mocks.getTopicForUser).not.toHaveBeenCalled();
  });

  it('does not reset a plan step when selecting the same chat on reload', async () => {
    mocks.getCurrentTopic.mockResolvedValue({ topic, part: 'Binary', currentStepId: 'step-binary' });
    const response = await request('/topics/topic_requested/select', 'POST');
    expect(response.status).toBe(200);
    expect(mocks.setCurrentTopic).not.toHaveBeenCalled();
  });
});
