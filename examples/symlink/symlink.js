import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [operation, directory] = process.argv.slice(2);
assert.ok(directory, 'a disposable fixture root is required');
const root = fs.realpathSync(directory);
const at = (file) => path.join(root, file);
const readJson = (file) => JSON.parse(fs.readFileSync(at(file), 'utf8'));
const catalogFile = 'source/dotfiles/catalog.json';
const selfEntry = {
  name: 'fixture-self',
  source: { source: 'local', path: './.codex/plugins/fixture-self' },
  policy: { installation: 'AVAILABLE', authentication: 'ON_USE' },
};
const links = [
  ['home/.codex', 'state'],
  ['home/.agents', 'source/dotfiles/.agents'],
  ['home/plugins', 'source/dotfiles/plugins'],
  ['home/.agents/plugins/marketplace.json', catalogFile],
  ['home/.codex/plugins/fixture-self', 'source'],
  ['home/plugins/unrelated', 'external'],
];
const linkState = () =>
  links.map(([file]) => {
    const stat = fs.lstatSync(at(file));
    assert.ok(stat.isSymbolicLink(), file);
    return { file, ino: stat.ino, target: fs.readlinkSync(at(file)) };
  });

if (operation === 'setup') {
  assert.deepEqual(fs.readdirSync(root), [], 'setup requires an empty disposable root');
  for (const file of [
    'home',
    'state/plugins',
    'source/dotfiles/.agents/plugins',
    'source/dotfiles/plugins',
    'source/.codex-plugin',
    'external/.codex-plugin',
  ]) {
    fs.mkdirSync(at(file), { recursive: true });
  }
  for (const [source, name] of [
    ['source', 'fixture-self'],
    ['external', 'fixture-external'],
  ]) {
    fs.writeFileSync(
      at(source + '/.codex-plugin/plugin.json'),
      JSON.stringify({ name, version: '1.0.0' }),
    );
    fs.writeFileSync(
      at(source + '/package.json'),
      JSON.stringify({ codexTools: { managedPaths: ['.codex-plugin', 'payload.txt'] } }),
    );
    fs.writeFileSync(at(source + '/payload.txt'), name + '\n');
  }
  fs.writeFileSync(
    at(catalogFile),
    JSON.stringify({
      name: 'linked-market',
      interface: { displayName: 'Keep this identity' },
      plugins: [selfEntry],
    }),
  );
  fs.chmodSync(at(catalogFile), 0o640);
  for (const [file, target] of links) fs.symlinkSync(at(target), at(file));
  fs.writeFileSync(at('links-before.json'), JSON.stringify(linkState()));
} else if (operation === 'preserved') {
  assert.deepEqual(linkState(), readJson('links-before.json'));
  const catalog = readJson(catalogFile);
  assert.equal(catalog.name, 'linked-market');
  assert.deepEqual(catalog.interface, { displayName: 'Keep this identity' });
  assert.deepEqual(
    catalog.plugins.find((entry) => entry.name === selfEntry.name),
    selfEntry,
  );
  assert.equal(fs.statSync(at(catalogFile)).mode & 0o777, 0o640);
} else {
  throw new Error('unknown fixture operation: ' + operation);
}
