import { loadEnv } from '@provenant/config';
import { buildStore } from './store';

const env = loadEnv();
const app = await buildStore({
  baseUrl: env.DEMO_STORE_URL,
  logger: true,
  provenant: env.PROVENANT_MERCHANT_API_KEY
    ? { baseUrl: env.PUBLIC_BASE_URL, apiKey: env.PROVENANT_MERCHANT_API_KEY }
    : undefined,
});
await app.listen({ port: env.DEMO_STORE_PORT, host: '0.0.0.0' });
