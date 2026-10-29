/**
 * Entry points for pictures: "Ảnh" opens the file picker, "Chữ ký" opens the
 * signature dialog; both end in placement mode (placement.tsx).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { prepareImage } from './image-data';
import { PlacementProvider, usePlacement } from './placement';
import { SignatureDialog } from './signature-dialog';

interface PicturesApi {
  pickImage: () => void;
  openSignature: () => void;
  signatureOpen: boolean;
  /** last problem reading a picture, shown under the toolbar */
  error: string | null;
  clearError: () => void;
}

const Ctx = createContext<PicturesApi | null>(null);
export const usePictures = () => useContext(Ctx);

function Inner({ children }: { children: ReactNode }) {
  const placement = usePlacement();
  const input = useRef<HTMLInputElement>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickImage = useCallback(() => {
    placement?.cancel();
    input.current?.click();
  }, [placement]);
  const openSignature = useCallback(() => {
    placement?.cancel();
    setSigOpen(true);
  }, [placement]);

  const api = useMemo(
    () => ({
      pickImage,
      openSignature,
      signatureOpen: sigOpen,
      error: error ?? placement?.error ?? null,
      clearError: () => setError(null),
    }),
    [pickImage, openSignature, sigOpen, error, placement?.error],
  );

  return (
    <Ctx.Provider value={api}>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/*"
        className="hidden"
        data-testid="image-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          try {
            placement?.start('image', await prepareImage(f));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {children}
      <SignatureDialog open={sigOpen} onOpenChange={setSigOpen} onReady={(img) => placement?.start('signature', img)} />
    </Ctx.Provider>
  );
}

export function PicturesProvider({ documentId, children }: { documentId: string; children: ReactNode }) {
  return (
    <PlacementProvider documentId={documentId}>
      <Inner>{children}</Inner>
    </PlacementProvider>
  );
}
