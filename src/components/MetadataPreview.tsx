import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMetadata, fetchMetadataImage, METADATA_BYTES, parseMetadata, resolveMetadataUri } from '../core/metadata';
import type { Metadata } from '../core/metadata';
import '../styles/metadata.css';

type Props = { uri: string; tokenId: string; itemName: string; onUseName: (name: string) => void };
export function MetadataPreview({ uri, tokenId, itemName, onUseName }: Props) {
  const [metadata, setMetadata] = useState<Metadata>();
  const [status, setStatus] = useState('Add a metadata URI or load local JSON.');
  const [image, setImage] = useState('');
  const [imageError, setImageError] = useState('');
  const [thumbnailVisible, setThumbnailVisible] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const imageEligible = thumbnailVisible || cardOpen;
  const [revision, setRevision] = useState(0);
  const [position, setPosition] = useState({ top: 12, left: 12, maxHeight: 500 });
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressFocus = useRef(false);
  const refreshRequested = useRef(false);
  const id = useId();
  useEffect(() => {
    const thumbnail = trigger.current;
    if (!thumbnail || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      setThumbnailVisible(entries.some(entry => entry.isIntersecting));
    }, { rootMargin: '100px', threshold: 0 });
    observer.observe(thumbnail);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const bypassCache = refreshRequested.current; refreshRequested.current = false;
    const pending = new AbortController(); controller.current = pending; setMetadata(undefined); setImage(''); setImageError('');
    if (!uri) { setStatus('Add a metadata URI or load local JSON.'); return () => { pending.abort(); controller.current?.abort(); }; }
    try { resolveMetadataUri(uri, tokenId); } catch (error) { setStatus(error instanceof Error ? error.message : 'Invalid metadata URI.'); return () => { pending.abort(); controller.current?.abort(); }; }
    setStatus('Waiting to preview…');
    const timer = setTimeout(() => { setStatus('Loading metadata…'); fetchMetadata(uri, tokenId, pending.signal, bypassCache).then(data => { if (!pending.signal.aborted) { setMetadata(data); setStatus('Remote metadata · preview only'); } }).catch(error => { if (!pending.signal.aborted) setStatus(error instanceof Error ? error.message : 'Metadata unavailable.'); }); }, 600);
    return () => { clearTimeout(timer); pending.abort(); controller.current?.abort(); };
  }, [uri, tokenId, revision]);
  useEffect(() => {
    const pending = new AbortController(); let objectUrl = ''; setImage(''); setImageError('');
    if (metadata?.image && imageEligible) fetchMetadataImage(metadata.image, pending.signal).then(blob => { if (!pending.signal.aborted) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl); } }).catch(error => { if (!pending.signal.aborted) setImageError(error instanceof Error ? error.message : 'Image unavailable.'); });
    return () => { pending.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [metadata, imageEligible]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    const reposition = (event: Event) => {
      if (!card.current?.matches(':popover-open') || event.target instanceof Node && card.current.contains(event.target)) return;
      positionCard();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, []);
  function positionCard() {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    if (box.bottom < 0 || box.top > window.innerHeight) { card.current?.hidePopover(); return; }
    const top = Math.max(12, Math.min(box.bottom + 8, window.innerHeight - Math.min(540, window.innerHeight - 24)));
    setPosition({ left: Math.min(Math.max(12, box.left), Math.max(12, window.innerWidth - 332)), top, maxHeight: Math.max(80, window.innerHeight - top - 12) });
  }
  function open(focus = false) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    positionCard();
    if (card.current && !card.current.matches(':popover-open')) card.current.showPopover();
    if (focus) card.current?.focus();
  }
  function closeLater() { closeTimer.current = setTimeout(() => { if (!card.current?.matches(':hover') && !card.current?.contains(document.activeElement) && document.activeElement !== trigger.current) card.current?.hidePopover(); }, 180); }
  function close() { suppressFocus.current = true; card.current?.hidePopover(); trigger.current?.focus(); }
  async function localJson(selected?: File) {
    if (!selected) return;
    controller.current?.abort(); const pending = new AbortController(); controller.current = pending; setMetadata(undefined); setImage(''); setImageError('');
    try { if (selected.size > METADATA_BYTES) throw new Error('Metadata exceeds 256 KB.'); const data = parseMetadata(await selected.text(), tokenId); if (!pending.signal.aborted) { setMetadata(data); setStatus('Local JSON · preview only'); } }
    catch (error) { if (!pending.signal.aborted) setStatus(error instanceof Error ? error.message : 'Could not read local JSON.'); }
    if (file.current) file.current.value = '';
  }
  return <>
    <button ref={trigger} className="metadata-thumb" aria-label={`Preview metadata for ${itemName || 'unnamed item'}`} aria-controls={id} aria-haspopup="dialog" onMouseEnter={() => open()} onMouseLeave={closeLater} onFocus={() => { if (suppressFocus.current) suppressFocus.current = false; else open(); }} onBlur={closeLater} onClick={() => open(true)}>{image ? <img src={image} alt="" onError={() => { setImage(''); setImageError('The image could not be decoded.'); }} /> : <span aria-hidden="true">◇</span>}</button>
    {createPortal(<div id={id} ref={card} popover="auto" onToggle={event => setCardOpen(event.newState === 'open')} tabIndex={-1} role="dialog" aria-label={`Metadata preview for ${itemName || 'item'}`} className="metadata-card" style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }} onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current); }} onMouseLeave={closeLater} onBlur={closeLater} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="metadata-card-heading"><span>Metadata preview</span><button aria-label="Close metadata preview" onClick={close}>×</button></div>
      {image && <img className="metadata-art" src={image} alt={metadata?.name ?? itemName} />}
      <p className="metadata-status" role="status">{status}</p>{imageError && <p className="metadata-error">{imageError}</p>}
      {metadata && <><h3>{metadata.name || itemName || 'Untitled asset'}</h3>{metadata.description && <p className="metadata-description">{metadata.description}</p>}{metadata.attributes.length > 0 && <dl className="metadata-traits">{metadata.attributes.map((trait, i) => <div key={i}><dt>{trait.trait}</dt><dd>{trait.value}</dd></div>)}</dl>}{metadata.name && <button disabled={metadata.name.length > 80 || metadata.name === itemName} onClick={() => onUseName(metadata.name!)}>Use metadata name</button>}{metadata.name && metadata.name.length > 80 && <p className="metadata-error">Metadata name exceeds the 80-character item-name limit.</p>}</>}
      <div className="metadata-actions"><button disabled={!uri} onClick={() => { refreshRequested.current = true; setRevision(n => n + 1); }}>Refresh</button><button onClick={() => file.current?.click()}>Load local JSON</button><input ref={file} type="file" accept=".json,application/json" className="sr-only" aria-label="Load local metadata JSON" onChange={event => localJson(event.target.files?.[0])} /></div><p className="metadata-note">Preview data stays local and is not added to generated files. HTTPS hosts and public IPFS/Arweave gateways must allow CORS.</p>
    </div>, document.body)}
  </>;
}
