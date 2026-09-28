/**
 * Multer can expose a UTF-8 multipart filename as a latin1 string. Decode only the characteristic
 * mojibake cases so correctly decoded names remain byte-for-byte unchanged.
 */
export function decodeMultipartFilename(name: string): string {
  if (!/[ÃÐÑÂâ]/.test(name)) return name;
  try {
    const repaired = Buffer.from(name, 'latin1').toString('utf8');
    return repaired.includes('\uFFFD') ? name : repaired;
  } catch {
    return name;
  }
}
