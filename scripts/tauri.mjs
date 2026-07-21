import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const prepareOnly = args[0] === '--prepare-only';
const release = args[0] === 'build' || args.includes('--release');
const host = execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error('Could not determine the Rust host triple.');
const extension = process.platform === 'win32' ? '.exe' : '';
const directory = join('src-tauri', 'binaries');
const destination = join(directory, `tesapi-mcp-${host}${extension}`);
mkdirSync(directory, { recursive: true });
if (!existsSync(destination)) writeFileSync(destination, '');
const manifest = join('src-tauri', 'Cargo.toml');
const cargoArgs = ['build', '--manifest-path', manifest, '--bin', 'tesapi-mcp'];
if (release) cargoArgs.push('--release');
execFileSync('cargo', cargoArgs, { stdio: 'inherit' });

const source = join('src-tauri', 'target', release ? 'release' : 'debug', `tesapi-mcp${extension}`);
copyFileSync(source, destination);

if (prepareOnly) process.exit(0);

const tauri = join('node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
const result = spawnSync(tauri, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
