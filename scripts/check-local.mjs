#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

const REQUIRED_MAJOR = 22;
const REQUIRED_MINOR = 5;

function parseSemver(version) {
  const [major = 0, minor = 0, patch = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

function isNodeSupported(version) {
  const { major, minor } = parseSemver(version);
  return major > REQUIRED_MAJOR || (major === REQUIRED_MAJOR && minor >= REQUIRED_MINOR);
}

function checkPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

async function run() {
  const nodeVersion = process.version;
  let hasError = false;

  // Check built-in node:sqlite directly
  try {
    const sqlite = await import('node:sqlite');
    if (!sqlite.DatabaseSync) throw new Error('DatabaseSync missing');
    if (!QUIET) {
      console.log(`[OK] Node.js ${nodeVersion} with built-in node:sqlite WAL engine available`);
    }
  } catch (err) {
    hasError = true;
    console.error(`\n[MedSupply Sentinel] Unsupported Node.js version: ${nodeVersion}`);
    console.error(
      `Required: Node.js v${REQUIRED_MAJOR}.${REQUIRED_MINOR}.0 or newer (needed for built-in node:sqlite).\n`
    );
    console.error('How to upgrade quickly:');
    console.error('  Windows (PowerShell):  winget install OpenJS.NodeJS.LTS');
    console.error('  macOS (Homebrew):      brew install node@22');
    console.error('  Linux / nvm:           nvm install 22 && nvm use 22\n');
    if (!isNodeSupported(nodeVersion)) {
      console.error(`[FAIL] Built-in node:sqlite could not be loaded: ${String(err)}`);
    }
  }

  // Check data directory writeability
  const dataDir = path.join(ROOT_DIR, 'data');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.accessSync(dataDir, fs.constants.W_OK);
    if (!QUIET) console.log(`[OK] SQLite ledger directory writable (${dataDir})`);
  } catch (err) {
    hasError = true;
    console.error(`[FAIL] Cannot write to ./data directory: ${String(err)}`);
  }

  if (!QUIET) {
    const envExists = fs.existsSync(path.join(ROOT_DIR, '.env'));
    console.log(
      envExists
        ? '[OK] Optional .env file detected'
        : '[INFO] No .env file present (optional — built-in zero-config defaults active)'
    );

    const targetPort = Number(process.env.PORT) || 3000;
    const portFree = await checkPortFree(targetPort);
    if (portFree) {
      console.log(`[OK] Port ${targetPort} is available`);
    } else {
      console.log(
        `[INFO] Port ${targetPort} is currently in use (server will automatically pick the next free port unless PORT is pinned)`
      );
    }
  }

  if (hasError) {
    process.exit(1);
  }
}

run();
