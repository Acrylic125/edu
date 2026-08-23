import { PRESIGN_GET_EXPIRES_SECONDS } from "./limits";
import { presignGetUrl } from "./r2";

function toBase64Url(bytes: ArrayBuffer) {
	const bin = String.fromCharCode(...new Uint8Array(bytes));
	return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const padLength = (4 - (padded.length % 4)) % 4;
	const binary = atob(`${padded}${"=".repeat(padLength)}`);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

async function hmacKey(secret: string) {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function signAssetContentAccess(params: {
	secret: string;
	assetId: string;
	expiresAt: number;
}) {
	const key = await hmacKey(params.secret);
	const payload = `${params.assetId}.${params.expiresAt}`;
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(payload),
	);
	return toBase64Url(signature);
}

export async function verifyAssetContentAccess(params: {
	secret: string;
	assetId: string;
	expiresAt: number;
	signature: string;
}) {
	if (!Number.isFinite(params.expiresAt) || params.expiresAt * 1000 < Date.now()) {
		return false;
	}
	const key = await hmacKey(params.secret);
	const payload = `${params.assetId}.${params.expiresAt}`;
	try {
		return await crypto.subtle.verify(
			"HMAC",
			key,
			fromBase64Url(params.signature),
			new TextEncoder().encode(payload),
		);
	} catch {
		return false;
	}
}

export async function buildWorkerAssetContentUrl(params: {
	origin: string;
	secret: string;
	assetId: string;
}) {
	const expiresAt =
		Math.floor(Date.now() / 1000) + PRESIGN_GET_EXPIRES_SECONDS;
	const signature = await signAssetContentAccess({
		secret: params.secret,
		assetId: params.assetId,
		expiresAt,
	});
	const url = new URL(`/assets/${params.assetId}/content`, params.origin);
	url.searchParams.set("expires", String(expiresAt));
	url.searchParams.set("sig", signature);
	return url.toString();
}

export async function resolveAssetReadUrl(params: {
	env: Env;
	origin: string;
	assetId: string;
	storageKey: string;
}) {
	// Default to worker reads so local Miniflare never hits remote R2 URLs.
	if (params.env.ASSET_READ_MODE !== "presign") {
		return buildWorkerAssetContentUrl({
			origin: params.origin,
			secret: params.env.BETTER_AUTH_SECRET,
			assetId: params.assetId,
		});
	}

	return presignGetUrl(params.env, params.storageKey);
}
