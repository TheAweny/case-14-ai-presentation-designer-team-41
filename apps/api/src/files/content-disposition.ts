/**
 * Content-Disposition for the original template bytes. The name is the stored upload
 * name, so another instance can accept the same file through the existing upload.
 * A path, a control character, or a lone surrogate never reaches the header.
 */
const TEMPLATE_EXTENSION = /^(.*?)(\.(pptx|potx))$/i;

/** Drop C0 controls, DEL, and unpaired surrogates. encodeURIComponent throws on the latter. */
function stripUnsafe(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value.slice(index, index + 2);
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code <= 0x1f || code === 0x7f) continue;
    out += value.charAt(index);
  }
  return out;
}

function basename(fileName: string): string {
  const parts = fileName.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

/** Upload name reduced to one path segment, always ending in .pptx or .potx. */
export function originalDownloadName(fileName: string): string {
  const base = stripUnsafe(basename(fileName)).trim();
  const matched = TEMPLATE_EXTENSION.exec(base);
  if (!matched) {
    const stem = base.replace(/[. ]+$/g, '').trim();
    return (stem || 'template') + '.pptx';
  }
  const stem = (matched[1] ?? '').trim();
  const extension = matched[2] ?? '.pptx';
  return (stem || 'template') + extension;
}

function asciiFallback(name: string): string {
  if (/^[\x20-\x7E]+$/.test(name) && !/["\\]/.test(name)) return name;
  return /\.potx$/i.test(name) ? 'template.potx' : 'template.pptx';
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

export function contentDisposition(fileName: string): string {
  const name = originalDownloadName(fileName);
  return (
    'attachment; filename="' + asciiFallback(name) + "\"; filename*=UTF-8''" + encodeRfc5987(name)
  );
}
