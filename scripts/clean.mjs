import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const target = resolve(import.meta.dirname, '..', 'dist');
await rm(target, { recursive: true, force: true });
