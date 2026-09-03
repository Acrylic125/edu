interface Env {
	BETTER_AUTH_SECRET: string;
	LANGTRACE_API_HOST?: string;
	LANGTRACE_API_KEY?: string;
	OPENROUTER_API_KEY: string;
	OPENROUTER_MODEL?: string;
	WEB_ORIGIN: string;
	ASSET_READ_MODE: "worker" | "presign";
	ASSETS: R2Bucket;
	R2_ACCOUNT_ID: string;
	R2_ACCESS_KEY_ID: string;
	R2_SECRET_ACCESS_KEY: string;
	R2_BUCKET_NAME: string;
}
