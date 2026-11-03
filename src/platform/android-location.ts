/**
 * Where an Android document is, from its content:// address. Android hands
 * the app an address, not a path; for the system's own storage the address
 * spells the path out (com.android.externalstorage.documents:
 * "primary:Download/a.pdf" is /storage/emulated/0/Download/a.pdf), for other
 * providers only the place it came from is known (Tải xuống, Google Drive,
 * an app's own storage). Kept free of Capacitor so it can be tested on its own.
 */

const EXTERNAL = 'com.android.externalstorage.documents';
const DOWNLOADS = 'com.android.providers.downloads.documents';

/** providers people meet when they open a file, by their authority */
const PROVIDER_NAME: Record<string, string> = {
  [EXTERNAL]: 'Bộ nhớ máy',
  [DOWNLOADS]: 'Tải xuống (Download)',
  'com.android.providers.media.documents': 'Thư viện của máy',
  media: 'Thư viện của máy',
  'com.google.android.apps.docs.storage': 'Google Drive',
  'com.google.android.apps.docs.storage.legacy': 'Google Drive',
  'com.microsoft.skydrive.content.StorageAccessProvider': 'OneDrive',
  'com.dropbox.product.android.dbapp.document_provider.documents': 'Dropbox',
};

export interface AndroidLocation {
  /** the full path, when the address tells it */
  path?: string;
  /** where it came from, when there is no path */
  from?: string;
  /** a document of a documents provider: the system's file picker can open its folder */
  browsable: boolean;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * `uri`: the content:// address; `label`: the provider's own name as the
 * system gives it (used when ezPDF has none of its own).
 */
export function androidLocation(uri: string, label?: string): AndroidLocation {
  const m = /^content:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(uri);
  if (!m) return { browsable: false };
  const authority = m[1];
  const segs = (m[2] ?? '').split('/').filter(Boolean);
  // …/document/<id>, or …/tree/<tree id>/document/<id>
  const at = segs.lastIndexOf('document');
  const id = at >= 0 && at + 1 < segs.length ? decode(segs[at + 1]) : null;
  const named = PROVIDER_NAME[authority] ?? (label && label.trim() ? label.trim().slice(0, 80) : undefined);
  const out: AndroidLocation = { browsable: id !== null };
  if (id !== null && authority === EXTERNAL) {
    const colon = id.indexOf(':');
    if (colon > 0) {
      const volume = id.slice(0, colon), rest = id.slice(colon + 1).replace(/^\/+/, '');
      // "home" is the Documents folder of the phone's storage (Android 10+)
      const root = /^primary$/i.test(volume)
        ? '/storage/emulated/0'
        : /^home$/i.test(volume)
          ? '/storage/emulated/0/Documents'
          : /^[0-9A-F]{4}-[0-9A-F]{4}$/i.test(volume)
            ? `/storage/${volume.toUpperCase()}`
            : null;
      if (root && !/(^|\/)\.\.(\/|$)/.test(rest)) out.path = rest ? `${root}/${rest}` : root;
    }
  } else if (id !== null && authority === DOWNLOADS && id.startsWith('raw:/')) {
    const path = id.slice(4);
    if (!/(^|\/)\.\.(\/|$)/.test(path)) out.path = path;
  }
  if (!out.path && named) out.from = named;
  return out;
}
