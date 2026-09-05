import { createAuth } from '../auth';

function sessionHeaders(request: Request) {
	const headers = new Headers(request.headers);
	const protocols =
		headers
			.get('sec-websocket-protocol')
			?.split(',')
			.map((value) => value.trim()) ?? [];
	const credential = protocols.find((value) => value.startsWith('edu-auth.'));
	if (credential && !headers.has('authorization')) {
		try {
			headers.set('Authorization', `Bearer ${atob(credential.slice(9).replace(/-/g, '+').replace(/_/g, '/'))}`);
		} catch {
			/* Malformed credentials are rejected by session validation. */
		}
	}

	return headers;
}

export async function requireUser(request: Request, env: Env): Promise<{ userId: string; expiresAt: number } | Response> {
	const auth = createAuth(env);
	const session = await auth.api.getSession({
		headers: sessionHeaders(request),
	});

	if (!session?.user?.id) {
		return new Response(JSON.stringify({ error: 'Unauthorized' }), {
			status: 401,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	return { userId: session.user.id, expiresAt: session.session.expiresAt.getTime() };
}
