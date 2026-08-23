import { createAuth } from "../auth";

function sessionHeaders(request: Request) {
	const headers = new Headers(request.headers);
	const url = new URL(request.url);
	const token = url.searchParams.get("token");

	if (token && !headers.get("authorization")) {
		headers.set("Authorization", `Bearer ${token}`);
	}

	return headers;
}

export async function requireUser(
	request: Request,
	env: Env,
): Promise<{ userId: string } | Response> {
	const auth = createAuth(env);
	const session = await auth.api.getSession({
		headers: sessionHeaders(request),
	});

	if (!session?.user?.id) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
			headers: { "Content-Type": "application/json" },
		});
	}

	return { userId: session.user.id };
}
