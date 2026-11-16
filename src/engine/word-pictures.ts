/**
 * "PDF sửa được chữ" (src/ocr/editable-pdf.ts) draws each word OCR read in
 * a Type 3 font of its own whose glyphs are whole words, drawn with the
 * word's own shape from the scan. The fonts carry this /BaseFont so the
 * edit tool knows them: a changed word is set again on its own (its
 * neighbours keep their shapes), instead of the whole run of the font.
 */
export const WORD_PICTURES_FONT = 'ezOCR-Words';

export const isWordPictures = (fontName: string) => fontName === WORD_PICTURES_FONT;
