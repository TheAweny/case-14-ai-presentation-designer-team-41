import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition.js';

describe('contentDisposition', () => {
  it('keeps an ASCII pptx and potx name and extension', () => {
    expect(contentDisposition('brand.pptx')).toBe(
      'attachment; filename="brand.pptx"; filename*=UTF-8\'\'brand.pptx',
    );
    expect(contentDisposition('Brand.POTX')).toBe(
      'attachment; filename="Brand.POTX"; filename*=UTF-8\'\'Brand.POTX',
    );
  });

  it('puts a Unicode name in filename* and uses a fixed ASCII fallback', () => {
    const header = contentDisposition(
      '\u0428\u0430\u0431\u043b\u043e\u043d \u043a\u0432\u0430\u0440\u0442\u0430\u043b\u0430.pptx',
    );
    expect(header).toContain('filename="template.pptx"');
    expect(header).toContain(
      "filename*=UTF-8''" +
        encodeURIComponent(
          '\u0428\u0430\u0431\u043b\u043e\u043d \u043a\u0432\u0430\u0440\u0442\u0430\u043b\u0430.pptx',
        ),
    );
    expect(header).not.toMatch(/[\r\n]/);
  });

  it('does not let quotes or header breaks escape the quoted filename', () => {
    const header = contentDisposition('say "hi"\r\nX-Injected: yes.potx');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('.potx');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('filename="template.potx"');
  });

  it('strips NUL from the header and keeps the extension', () => {
    const header = contentDisposition('bad\u0000name.pptx');
    expect(header).not.toContain('\u0000');
    expect(header).toContain('filename="badname.pptx"');
    expect(header).toContain("filename*=UTF-8''badname.pptx");
  });

  it('uses only the basename of a relative or Windows path', () => {
    expect(contentDisposition('../x.pptx')).toBe(
      'attachment; filename="x.pptx"; filename*=UTF-8\'\'x.pptx',
    );
    expect(contentDisposition('C:\\Users\\tmp\\deck.potx')).toBe(
      'attachment; filename="deck.potx"; filename*=UTF-8\'\'deck.potx',
    );
  });

  it('drops a lone surrogate so encodeURIComponent never throws', () => {
    expect(contentDisposition('ok\uD800file.pptx')).toBe(
      'attachment; filename="okfile.pptx"; filename*=UTF-8\'\'okfile.pptx',
    );
  });

  it('falls back to template.pptx for an empty name', () => {
    expect(contentDisposition('')).toBe(
      'attachment; filename="template.pptx"; filename*=UTF-8\'\'template.pptx',
    );
    expect(contentDisposition('   ')).toBe(
      'attachment; filename="template.pptx"; filename*=UTF-8\'\'template.pptx',
    );
  });
});
