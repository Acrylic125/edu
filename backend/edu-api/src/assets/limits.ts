import { safetyLimits } from '../billing/plans';
export const MAX_IMAGE_BYTES = safetyLimits.imageBytes;
export const MAX_PDF_BYTES = safetyLimits.pdfBytes;
export const MAX_MESSAGE_ASSETS = safetyLimits.attachmentsPerMessage;
export const PRESIGN_PUT_EXPIRES_SECONDS = 10 * 60;
export const PRESIGN_GET_EXPIRES_SECONDS = 60 * 60;

export const ALLOWED_ASSET_MIME_TYPES = [
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
	"application/pdf",
] as const;

export function maxAssetBytes(mimeType: string) {
	if (mimeType === 'application/pdf') return MAX_PDF_BYTES;
	return MAX_IMAGE_BYTES;
}
