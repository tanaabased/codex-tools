import { parse } from 'smol-toml';

/** parses codex configuration without coupling runtime code to bun. */
export default function parseToml(value: string): unknown {
  return parse(value);
}
