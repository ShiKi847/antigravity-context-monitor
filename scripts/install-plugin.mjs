/**
 * @fileoverview Script to install Antigravity Context Monitor to Antigravity's plugin directory.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TARGET_DIR = join(homedir(), '.gemini', 'config', 'plugins', 'antigravity-context-monitor');

console.log(`Installing Antigravity Context Monitor to:\n${TARGET_DIR}\n`);

try {
  mkdirSync(TARGET_DIR, { recursive: true });

  // Copy files
  const items = [
    'plugin.json',
    'package.json',
    'assets',
    'sidecars',
    'src'
  ];

  for (const item of items) {
    const srcPath = join(ROOT, item);
    const destPath = join(TARGET_DIR, item);
    if (existsSync(srcPath)) {
      cpSync(srcPath, destPath, { recursive: true, force: true });
      console.log(`  [OK] Copied ${item}`);
    }
  }

  console.log('\nInstallation successful! Antigravity will detect this extension under "Customizations -> Installed".');
} catch (err) {
  console.error('\nInstallation failed:', err.message);
  process.exit(1);
}
