let applying = 0;

export const isApplyingCloudSnapshot = () => applying > 0;

export async function applyCloudSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  applying += 1;
  try { return await operation(); }
  finally { applying -= 1; }
}
