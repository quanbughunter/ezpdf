/**
 * A .docx is a zip of XML parts. Opened here, written back with every part
 * exactly as it was except the ones ezPDF changed (word/document.xml), in
 * the original order. Nothing leaves the device.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { attrNS, elements, NS, parseXml, resolvePath, type DomImpl } from './xml';

export class WordOpenError extends Error {}

export interface Rel {
  id: string;
  type: string;
  /** package path for internal targets, the URL for external ones */
  target: string;
  external: boolean;
}

export interface DocxPackage {
  /** entry names in zip order */
  names: string[];
  files: Record<string, Uint8Array>;
  /** the main document part, usually word/document.xml */
  main: string;
  text(path: string): string | null;
  rels(part: string): Map<string, Rel>;
}

const OFFICE_DOC = /\/officeDocument$/;
const DOCX_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const MACRO_MAIN = 'application/vnd.ms-word.document.macroEnabled.main+xml';
const TEMPLATE_MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';

/** What kind of file these bytes are, before trying to read them as Word. */
export function sniff(bytes: Uint8Array): 'zip' | 'ole' | 'pdf' | 'other' {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'zip';
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return 'ole';
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  return 'other';
}

export function openPackage(bytes: Uint8Array, dom: DomImpl): DocxPackage {
  const kind = sniff(bytes);
  if (kind === 'ole') {
    throw new WordOpenError(
      'Đây là tệp Word kiểu cũ (.doc, Word 97–2003) hoặc tệp Word có mật khẩu. ezPDF mở được .docx: hãy mở tệp bằng Word rồi lưu lại thành .docx, không đặt mật khẩu.',
    );
  }
  if (kind !== 'zip') throw new WordOpenError('Tệp này không phải tệp Word .docx.');
  let files: Record<string, Uint8Array>;
  // a few hundred MB unpacked is far beyond any real document: refuse a zip bomb before it fills the memory
  let total = 0;
  let tooBig = false;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (f.originalSize > MAX_PART || total > MAX_TOTAL) tooBig = true;
        return !tooBig;
      },
    });
  } catch {
    throw new WordOpenError('Tệp Word bị hỏng: không giải nén được.');
  }
  if (tooBig) throw new WordOpenError('Tệp Word này quá lớn khi giải nén (trên 400 MB), ezPDF không mở.');
  const names = Object.keys(files);
  const text = (path: string) => (files[path] ? strFromU8(files[path]) : null);
  const relsCache = new Map<string, Map<string, Rel>>();
  const rels = (part: string) => {
    let m = relsCache.get(part);
    if (m) return m;
    m = new Map();
    const slash = part.lastIndexOf('/');
    const relPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
    const xml = text(relPath);
    if (xml) {
      const doc = parseXml(dom, xml, relPath);
      for (const el of elements(doc.documentElement)) {
        if (el.localName !== 'Relationship') continue;
        const id = el.getAttribute('Id') ?? '';
        const target = el.getAttribute('Target') ?? '';
        const external = el.getAttribute('TargetMode') === 'External';
        m.set(id, { id, type: el.getAttribute('Type') ?? '', target: external ? target : resolvePath(part, target), external });
      }
    }
    relsCache.set(part, m);
    return m;
  };

  // the main part: from the package relationships, checked against [Content_Types].xml
  const root = rels('');
  const office = [...root.values()].find((r) => OFFICE_DOC.test(r.type));
  const main = office?.target ?? 'word/document.xml';
  if (!files[main]) throw new WordOpenError('Tệp không có phần nội dung Word (word/document.xml). Có thể đây là tệp Excel, PowerPoint hay một tệp nén khác.');
  const types = text('[Content_Types].xml');
  if (types) {
    const ct = parseXml(dom, types, '[Content_Types].xml');
    const over = elements(ct.documentElement).find((e) => e.localName === 'Override' && e.getAttribute('PartName') === `/${main}`);
    const type = over?.getAttribute('ContentType');
    // a file with macros (.docm) or a template (.dotx) saved under a .docx name would not open in Word
    if (type === MACRO_MAIN) throw new WordOpenError('Tệp Word có macro (.docm) chưa sửa được trong ezPDF. Hãy lưu lại trong Word dạng .docx (không macro).');
    if (type === TEMPLATE_MAIN) throw new WordOpenError('Tệp mẫu Word (.dotx) chưa sửa được trong ezPDF. Hãy tạo một tài liệu .docx từ mẫu rồi mở tài liệu đó.');
    if (type && type !== DOCX_MAIN) throw new WordOpenError('Tệp không phải văn bản Word (.docx).');
  }
  return { names, files, main, text, rels };
}

const MAX_PART = 200 * 1024 * 1024;
const MAX_TOTAL = 400 * 1024 * 1024;

/** Parts compressed again on save; pictures and fonts are stored as they are. */
const STORE = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp|odttf|ttf|otf|bin|mp4|wav)$/i;

/** The package with `changed` parts replaced, entries in their original order. */
export function writePackage(pkg: DocxPackage, changed: Record<string, string>): Uint8Array {
  const z: Zippable = {};
  for (const name of pkg.names) {
    const data = name in changed ? strToU8(changed[name]) : pkg.files[name];
    z[name] = [data, { level: STORE.test(name) ? 0 : 6 }];
  }
  return zipSync(z);
}

/** The external URL of a hyperlink relationship, for display only. */
export function relTarget(pkg: DocxPackage, part: string, rid: string | null): Rel | undefined {
  return rid ? pkg.rels(part).get(rid) : undefined;
}

export const rId = (el: Element, name = 'id') => attrNS(el, NS.r, name);
