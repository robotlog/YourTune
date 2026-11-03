// Writes the extension's symbolic icons from the Material Icons in YourTune's @mdui/icons
// dependency. Run from the repository root after `pnpm install`:
//   node extras/gnome-extension/tools/generate-icons.mjs
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Icon name in this extension -> @mdui/icons module.
const ICONS = {
  'previous': 'skip-previous--rounded',
  'next': 'skip-next--rounded',
  'play': 'play-arrow--rounded',
  'pause': 'pause--rounded',
  'shuffle': 'shuffle--rounded',
  'repeat': 'repeat--rounded',
  'repeat-one': 'repeat-one--rounded',
  'thumb-up': 'thumb-up--outlined',
  'thumb-up-filled': 'thumb-up--rounded',
  'thumb-down': 'thumb-down--outlined',
  'thumb-down-filled': 'thumb-down--rounded',
  'volume-high': 'volume-up--rounded',
  'volume-low': 'volume-down--rounded',
  'volume-muted': 'volume-off--rounded',
  'search': 'search--rounded',
  'play-next': 'queue-play-next--rounded',
  'open-in-new': 'open-in-new--rounded',
  'mix': 'sensors--rounded',
};

const require = createRequire(import.meta.url);
const source = dirname(require.resolve('@mdui/icons/package.json'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

for (const [name, module] of Object.entries(ICONS)) {
  const code = readFileSync(join(source, `${module}.js`), 'utf8');
  const body = code.match(/svgTag\('(.*?)'\)/s)?.[1];
  if (!body)
    throw new Error(`No SVG body in @mdui/icons/${module}.js`);
  // The -symbolic suffix makes GNOME Shell recolor the icon with the CSS color of its widget.
  writeFileSync(join(target, `${name}-symbolic.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>\n`);
}
console.log(`Wrote ${Object.keys(ICONS).length} icons to ${target}`);
