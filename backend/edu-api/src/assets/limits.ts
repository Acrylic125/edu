export const MAX_ASSET_BYTES = 256 * 1024;
export const MAX_MESSAGE_ASSETS = 5;
export const PRESIGN_PUT_EXPIRES_SECONDS = 10 * 60;
export const PRESIGN_GET_EXPIRES_SECONDS = 60 * 60;

export const ALLOWED_ASSET_MIME_TYPES = [
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;
