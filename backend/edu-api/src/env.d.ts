interface Env {
	BETTER_AUTH_SECRET: string;
	LANGTRACE_API_HOST?: string;
	LANGTRACE_API_KEY?: string;
	OPENROUTER_API_KEY: string;
	OPENROUTER_BASE_URL?: string;
	OPENROUTER_MODEL?: string;
	E2E_MODE?: "0" | "1";
	WEB_ORIGIN: string;
	ASSET_READ_MODE: "worker" | "presign";
	ASSETS: R2Bucket;
	PDF_INDEX_QUEUE: Queue<{ assetId: string; userId: string; nextPage: number }>;
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET_NAME: string;
}
