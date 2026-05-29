import { existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const prebuildsRoot = join(
  process.cwd(),
  'node_modules',
  '@homebridge',
  'node-pty-prebuilt-multiarch',
  'prebuilds'
);

if (!existsSync(prebuildsRoot)) {
  process.exit(0);
}

const platforms = readdirSync(prebuildsRoot).filter((name) =>
  statSync(join(prebuildsRoot, name)).isDirectory()
);

let created = 0;

for (const platform of platforms) {
  const platformDir = join(prebuildsRoot, platform);
  const files = readdirSync(platformDir);

  const nodeAbiFiles = files.filter(
    (f) => /^node\.abi\d+\.node$/.test(f)
  );

  for (const nodeFile of nodeAbiFiles) {
    const electronFile = nodeFile.replace(/^node\./, 'electron.');
    const src = join(platformDir, nodeFile);
    const dest = join(platformDir, electronFile);
    copyFileSync(src, dest);
    created++;
  }

  const abi127 = join(platformDir, 'node.abi127.node');
  if (existsSync(abi127)) {
    const dest128 = join(platformDir, 'electron.abi128.node');
    copyFileSync(abi127, dest128);
    created++;
  }
}

console.log(`ok (${created} aliases)`);
