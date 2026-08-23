import { createAuth } from "../auth";

export async function requireUser(
	request: Request,
	env: Env,
): Promise<{ userId: string } | Response> {
	const auth = createAuth(env);
	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user?.id) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	return { userId: session.user.id };
}
