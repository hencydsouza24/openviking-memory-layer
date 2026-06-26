import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import preact from '@preact/preset-vite';
import { defineConfig, loadEnv } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// Dev proxy: the agent loop runs entirely in the browser and talks to two
// relative prefixes; Vite forwards them so we never hit CORS.
//   /ov  -> OpenViking server   (SyncHTTPClient baseUrl = '/ov')
//   /llm -> OpenAI-compatible LLM (ChatOpenAI baseURL = '/llm')
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, '');
  const ov = new URL(env.OPENVIKING_URL || 'http://127.0.0.1:1933');
  const llm = new URL(env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  // rewrite "/ov/api/v1/x" -> "<ov.pathname>/api/v1/x", "/llm/models" -> "<llm.pathname>/models"
  const remap = (prefix: string, base: string) => (p: string) =>
    base.replace(/\/$/, '') + p.slice(prefix.length);

  return {
    root: here,
    plugins: [preact()],
    // Import the library straight from local source — tests exactly what we build.
    resolve: { alias: { '@ovlib': resolve(here, '../../src') } },
    server: {
      port: Number(env.PORT || 8788),
      proxy: {
        '/ov': { target: ov.origin, changeOrigin: true, rewrite: remap('/ov', ov.pathname) },
        '/llm': { target: llm.origin, changeOrigin: true, rewrite: remap('/llm', llm.pathname) },
      },
    },
  };
});
