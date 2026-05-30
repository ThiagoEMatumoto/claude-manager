import { existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

function aliasPrebuilds(prebuildsRoot) {
  if (!existsSync(prebuildsRoot)) {
    return 0;
  }

  const platforms = readdirSync(prebuildsRoot).filter((name) =>
    statSync(join(prebuildsRoot, name)).isDirectory()
  );

  let created = 0;

  for (const platform of platforms) {
    const platformDir = join(prebuildsRoot, platform);
    const files = readdirSync(platformDir);

    const nodeAbiFiles = files.filter((f) => /^node\.abi\d+\.node$/.test(f));

    for (const nodeFile of nodeAbiFiles) {
      const electronFile = nodeFile.replace(/^node\./, 'electron.');
      const dest = join(platformDir, electronFile);
      if (!existsSync(dest)) {
        copyFileSync(join(platformDir, nodeFile), dest);
        created++;
      }
    }

    const abi127 = join(platformDir, 'node.abi127.node');
    const dest128 = join(platformDir, 'electron.abi128.node');
    if (existsSync(abi127) && !existsSync(dest128)) {
      copyFileSync(abi127, dest128);
      created++;
    }
  }

  return created;
}

export default async function (context) {
  const { appOutDir } = context;
  const candidates = [
    join(
      appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '@homebridge',
      'node-pty-prebuilt-multiarch',
      'prebuilds'
    ),
    join(
      appOutDir,
      'resources',
      'app',
      'node_modules',
      '@homebridge',
      'node-pty-prebuilt-multiarch',
      'prebuilds'
    ),
  ];

  let total = 0;
  let matched = false;
  for (const root of candidates) {
    if (existsSync(root)) {
      matched = true;
      total += aliasPrebuilds(root);
    }
  }

  if (!matched) {
    console.warn('[afterPack] node-pty prebuilds not found in bundle');
    return;
  }

  console.log(`[afterPack] node-pty prebuild aliases created: ${total}`);
}
