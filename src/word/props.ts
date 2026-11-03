/**
 * A Word file's own properties, as Word shows them in File → Info:
 * docProps/core.xml (title, author, who saved it last, dates, revision) and
 * docProps/app.xml (the program, and the pages and words Word counted when it
 * last saved). Read for the file's information panel; never written back.
 * Every value is plain text or a number; a part that is missing or broken
 * leaves its values out.
 */
import type { DocxPackage } from './package';
import { parseXml, type DomImpl } from './xml';

export interface WordProps {
  title?: string;
  subject?: string;
  creator?: string;
  lastModifiedBy?: string;
  /** ms since 1970 */
  created?: number;
  modified?: number;
  revision?: number;
  /** the program that saved it (Microsoft Office Word, LibreOffice…) */
  application?: string;
  /** as counted by that program when it saved */
  pages?: number;
  words?: number;
}

const CORE = /\/metadata\/core-properties$/;
const APP = /\/extended-properties$/;

export function readProps(pkg: DocxPackage, dom: DomImpl): WordProps {
  const root = [...pkg.rels('').values()];
  const partOf = (type: RegExp, usual: string) => root.find((r) => type.test(r.type) && !r.external)?.target ?? usual;
  const load = (path: string) => {
    const text = pkg.text(path);
    if (!text) return null;
    try {
      return parseXml(dom, text, path);
    } catch {
      return null;
    }
  };
  const core = load(partOf(CORE, 'docProps/core.xml'));
  const app = load(partOf(APP, 'docProps/app.xml'));
  /** the first element called `local` (any namespace): its text, tidied and bounded */
  const text = (doc: Document | null, local: string) => {
    if (!doc) return undefined;
    const el = Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === local);
    const s = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return s ? s.slice(0, 300) : undefined;
  };
  const date = (doc: Document | null, local: string) => {
    const s = text(doc, local);
    const t = s ? Date.parse(s) : NaN;
    // W3CDTF; a year outside 1980–2200 is a broken or placeholder value
    return Number.isFinite(t) && t >= Date.UTC(1980, 0, 1) && t < Date.UTC(2200, 0, 1) ? t : undefined;
  };
  const count = (doc: Document | null, local: string) => {
    const s = text(doc, local);
    const n = s && /^\d{1,9}$/.test(s) ? Number(s) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const props: WordProps = {
    title: text(core, 'title'),
    subject: text(core, 'subject'),
    creator: text(core, 'creator'),
    lastModifiedBy: text(core, 'lastModifiedBy'),
    created: date(core, 'created'),
    modified: date(core, 'modified'),
    revision: count(core, 'revision'),
    application: text(app, 'Application'),
    pages: count(app, 'Pages'),
    words: count(app, 'Words'),
  };
  for (const k of Object.keys(props) as (keyof WordProps)[]) if (props[k] === undefined) delete props[k];
  return props;
}
