import { readFileSync } from 'node:fs';

export const suffix = () => ' from the bundle';

export const iconBase64 = () =>
  readFileSync(new URL('./skills/writer/assets/icon.png', import.meta.url), 'base64');
