/**
 * Minimal TrueType metrics reader (cmap format 4/12 + hmtx + hhea + head + OS/2).
 * The same font file is the browser's webfont and the font embedded on export,
 * so these advances are what both sides draw with.
 */
export interface FontMetrics {
  unitsPerEm: number;
  ascent: number; // font units, positive
  descent: number; // font units, positive
  capHeight: number; // font units
  bbox: [number, number, number, number]; // font units
  advance(codePoint: number): number; // font units
  has(codePoint: number): boolean;
  glyph(codePoint: number): number; // 0 = .notdef
  glyphAdvance(gid: number): number; // font units
}

export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = dv.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(
      dv.getUint8(rec),
      dv.getUint8(rec + 1),
      dv.getUint8(rec + 2),
      dv.getUint8(rec + 3),
    );
    tables.set(tag, dv.getUint32(rec + 8));
  }
  const need = (t: string) => {
    const o = tables.get(t);
    if (o === undefined) throw new Error(`font table ${t} missing`);
    return o;
  };
  const head = need('head');
  const hhea = need('hhea');
  const hmtx = need('hmtx');
  const cmap = need('cmap');
  const unitsPerEm = dv.getUint16(head + 18);
  const ascent = dv.getInt16(hhea + 4);
  const descent = -dv.getInt16(hhea + 6);
  const numHMetrics = dv.getUint16(hhea + 34);

  // cmap: prefer (3,10) format 12, else (3,1) format 4
  const glyphOf = new Map<number, number>();
  const nSub = dv.getUint16(cmap + 2);
  let best: { off: number; fmt: number } | null = null;
  for (let i = 0; i < nSub; i++) {
    const p = dv.getUint16(cmap + 4 + i * 8);
    const e = dv.getUint16(cmap + 6 + i * 8);
    const off = cmap + dv.getUint32(cmap + 8 + i * 8);
    const fmt = dv.getUint16(off);
    if (p === 3 && e === 10 && fmt === 12) best = { off, fmt };
    else if (!best && ((p === 3 && e === 1) || p === 0) && fmt === 4) best = { off, fmt };
  }
  if (!best) throw new Error('no usable cmap');
  if (best.fmt === 4) {
    const o = best.off;
    const segX2 = dv.getUint16(o + 6);
    const ends = o + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = dv.getUint16(ends + s);
      const start = dv.getUint16(starts + s);
      const delta = dv.getInt16(deltas + s);
      const ro = dv.getUint16(ranges + s);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g: number;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + s + ro + (c - start) * 2;
          g = dv.getUint16(gi);
          if (g !== 0) g = (g + delta) & 0xffff;
        }
        if (g) glyphOf.set(c, g);
      }
    }
  } else {
    const o = best.off;
    const nGroups = dv.getUint32(o + 12);
    for (let i = 0; i < nGroups; i++) {
      const g = o + 16 + i * 12;
      const start = dv.getUint32(g);
      const end = dv.getUint32(g + 4);
      const gid = dv.getUint32(g + 8);
      for (let c = start; c <= end; c++) glyphOf.set(c, gid + (c - start));
    }
  }
  const advOfGlyph = (gid: number) =>
    dv.getUint16(hmtx + 4 * Math.min(gid, numHMetrics - 1));
  const os2 = tables.get('OS/2');
  const capHeight = os2 !== undefined && dv.getUint16(os2) >= 2 ? dv.getInt16(os2 + 88) : ascent;
  const bbox: [number, number, number, number] = [
    dv.getInt16(head + 36),
    dv.getInt16(head + 38),
    dv.getInt16(head + 40),
    dv.getInt16(head + 42),
  ];
  return {
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    bbox,
    has: (cp) => glyphOf.has(cp),
    glyph: (cp) => glyphOf.get(cp) ?? 0,
    glyphAdvance: advOfGlyph,
    advance: (cp) => advOfGlyph(glyphOf.get(cp) ?? 0),
  };
}

export function textWidth(m: FontMetrics, text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += m.advance(ch.codePointAt(0)!);
  return (w * fontSize) / m.unitsPerEm;
}
