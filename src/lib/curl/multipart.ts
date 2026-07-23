import type { KeyValue } from '../../types/index.ts';
import { uid } from '../id.ts';

interface ParsedMultipart {
  rows: KeyValue[];
  missingFiles: string[];
}

export function parseRawMultipart(contentType: string | undefined, raw: string): ParsedMultipart | null {
  if (!contentType?.toLowerCase().includes('multipart/form-data')) return null;
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || !raw.includes(`--${boundary}`)) return null;

  const rows: KeyValue[] = [];
  const missingFiles: string[] = [];
  for (let part of raw.split(`--${boundary}`).slice(1)) {
    if (part.startsWith('--')) break;
    part = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
    const separator = part.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const split = part.indexOf(separator);
    if (split < 0) continue;
    const headerText = part.slice(0, split);
    const value = part.slice(split + separator.length).replace(/\r?\n$/, '');
    const disposition = headerText.split(/\r?\n/).find((line) => /^content-disposition:/i.test(line));
    const name = disposition?.match(/\bname="([^"]*)"/i)?.[1];
    if (!name) continue;
    const filename = disposition?.match(/\bfilename="([^"]*)"/i)?.[1];
    if (filename) {
      const mimeType = headerText.split(/\r?\n/).find((line) => /^content-type:/i.test(line))?.split(':').slice(1).join(':').trim() ?? '';
      rows.push({ id: uid(), key: name, value: '', enabled: true, valueType: 'file', files: [{ name: filename, mimeType, sizeBytes: 0, data: [] }] });
      missingFiles.push(filename);
    } else {
      rows.push({ id: uid(), key: name, value, enabled: true });
    }
  }
  return rows.length ? { rows, missingFiles } : null;
}
