import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { DishPhoto } from '../components/DishPhoto.js';
import { ErrorText, useSave } from './common.js';
import { preparePhoto, sizeText } from './photo.js';

/** The photo of one dish in its edit dialog: choose (resized here first), replace or remove. Saved at once. */
export function ItemPhoto({ itemId, name, image }: { itemId: string; name: string; image: string | null }) {
  const { save, busy, error, setError } = useSave();
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setNote(null);
    setPreparing(true);
    try {
      const p = await preparePhoto(file);
      if (await save('SetItemImage', { itemId, dataBase64: p.dataBase64 })) setNote(`Saved (${sizeText(p.originalBytes)} → ${sizeText(p.bytes)}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That photo could not be used.');
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-4" aria-label="Photo">
      <DishPhoto name={image} label={name} className="h-24 w-32 shrink-0 rounded-lg border border-border" />
      <div className="text-sm">
        <p className="font-semibold">Photo</p>
        <p className="text-xs text-muted-foreground">Shown on the billing screen in Photos view and on your website. JPG, PNG or WebP; it is resized here first.</p>
        <div className="mt-2 flex gap-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void choose(e.target.files?.[0])} aria-label="Choose a photo" />
          <button type="button" className="btn h-8" disabled={busy || preparing} onClick={() => input.current?.click()}>
            <ImagePlus className="h-4 w-4" /> {image ? 'Replace photo' : 'Add photo'}
          </button>
          {image ? (
            <button type="button" className="btn h-8" disabled={busy || preparing} onClick={() => void save('RemoveItemImage', { itemId }).then((ok) => ok && setNote('Photo removed.'))}>
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          ) : null}
        </div>
        {preparing ? <p className="mt-1 text-xs text-muted-foreground">Preparing the photo…</p> : null}
        {note ? <p className="mt-1 text-xs font-semibold text-ok">{note}</p> : null}
        <ErrorText error={error} />
      </div>
    </div>
  );
}
