export function migrate<T extends { schemaVersion?: number }>(value: T, currentVersion = 1): T {
  if ((value.schemaVersion ?? 1) > currentVersion) throw new Error(`Storage schema ${value.schemaVersion} is newer than this TesAPI version.`);
  return { ...value, schemaVersion: currentVersion };
}
