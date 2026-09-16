import { parse } from 'smol-toml';

/** Parses Codex configuration without coupling runtime code to Bun. */
export default function parseToml(value: string): unknown {
  return parse(value);
}
