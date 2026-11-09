// Reuses the regression fixture, never production or locally stored user data.
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { fieldData } = await server.ssrLoadModule('/tests/field-fixture.ts');
  const target = new URL('../android/app/src/androidTest/assets/', import.meta.url);
  await mkdir(target, { recursive: true });
  await writeFile(new URL('upgrade-data.json', target), JSON.stringify(fieldData(), null, 2) + '\n');
} finally { await server.close(); }
