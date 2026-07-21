import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tauriVersion = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).version;
const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const tagVersion = (process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME)?.replace(/^v/, '');
const versions = [packageVersion, tauriVersion, cargoVersion, ...(tagVersion ? [tagVersion] : [])];

if (versions.some((version) => version !== packageVersion)) {
  throw new Error(`Version mismatch: package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion}, tag=${tagVersion ?? 'n/a'}`);
}

console.log(`TesAPI version ${packageVersion} is consistent.`);
