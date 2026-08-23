import { AwsClient } from "aws4fetch";

import {
	PRESIGN_GET_EXPIRES_SECONDS,
	PRESIGN_PUT_EXPIRES_SECONDS,
} from "./limits";

function r2Client(env: Env) {
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		region: "auto",
		service: "s3",
	});
}

function objectUrl(env: Env, key: string) {
	return new URL(
		`https://${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`,
	);
}

function requireR2Credentials(env: Env) {
	if (
		!env.R2_ACCOUNT_ID ||
		!env.R2_ACCESS_KEY_ID ||
		!env.R2_SECRET_ACCESS_KEY ||
		!env.R2_BUCKET_NAME
	) {
		throw new Error("R2 credentials are not configured");
	}
}

export async function presignPutUrl(
	env: Env,
	params: { key: string; mimeType: string },
) {
	requireR2Credentials(env);
	const headers = {
		"Content-Type": params.mimeType,
	};
	const signed = await r2Client(env).sign(
		new Request(objectUrl(env, params.key), {
			method: "PUT",
			headers,
		}),
		{
			aws: {
				signQuery: true,
				expires: PRESIGN_PUT_EXPIRES_SECONDS,
			},
		},
	);
	return {
		url: signed.url,
		headers,
	};
}

export async function presignGetUrl(env: Env, key: string) {
	requireR2Credentials(env);
	const signed = await r2Client(env).sign(
		new Request(objectUrl(env, key), { method: "GET" }),
		{
			aws: {
				signQuery: true,
				expires: PRESIGN_GET_EXPIRES_SECONDS,
			},
		},
	);
	return signed.url;
}
