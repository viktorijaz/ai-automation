// Locally .env holds the secrets; on Vercel they come from the project settings
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile();
