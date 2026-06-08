/**
 * MapCanvas — Virtual Tabletop map
 *
 * Real-time architecture:
 *  - Token drag   : emitted every 16ms (live=true, no DB write) → interpolated on receive
 *  - Token drop   : emitted once (live=false, DB write) → snap to final position
 *  - Drawing      : each new point emitted every 16ms (no DB) → others see stroke growing
 *  - Drawing end  : full path emitted once (DB write) + finalize signal clears live preview
 *  - Fog / misc   : emitted on mouseUp
 *
 * All mutable draw data lives in refs so drawFrame() can be called synchronously
 * without waiting for React state reconciliation.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';
const VITE_API = import.meta.env.VITE_API_URL;
import DiceRoller from './DiceRoller';
import CombatTracker from './CombatTracker';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const CURSOR_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399']; //mettre en random les couleurs
const userColor = (id) => CURSOR_COLORS[Math.abs((id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % CURSOR_COLORS.length];

// Radius de vision du fog automatique (en nombre de cases de grille)
const VISION_NORMAL   = 3; // tous les tokens joueurs non cachés
const VISION_ENHANCED = 6; // tokens avec nightVision: true (vision nocturne étendue)

// ─── Conditions D&D standards ────────────────────────────────────────────────
const CONDITIONS = [
  { id: 'poisoned',     label: 'Empoisonné',  emoji: '🤢', color: '#2ecc71' },
  { id: 'stunned',      label: 'Étourdi',     emoji: '⭐', color: '#f1c40f' },
  { id: 'concentrated', label: 'Concentré',   emoji: '🎯', color: '#3498db' },
  { id: 'charmed',      label: 'Charmé',      emoji: '💕', color: '#e91e63' },
  { id: 'frightened',   label: 'Effrayé',     emoji: '😨', color: '#9b59b6' },
  { id: 'paralyzed',    label: 'Paralysé',    emoji: '⚡', color: '#e67e22' },
  { id: 'blinded',      label: 'Aveuglé',     emoji: '👁️', color: '#95a5a6' },
  { id: 'invisible',    label: 'Invisible',   emoji: '👻', color: '#bdc3c7' },
  { id: 'prone',        label: 'À terre',     emoji: '⬇️', color: '#e74c3c' },
  { id: 'restrained',   label: 'Entravé',     emoji: '⛓️', color: '#8e44ad' },
  { id: 'unconscious',  label: 'Inconscient', emoji: '💤', color: '#2c3e50' },
  { id: 'dead',         label: 'Mort',        emoji: '💀', color: '#c0392b' },
];

// ─── Test de sélection d'une forme de sort ──────────────────────────────────
function hitTestShape(shape, pos, threshold) {
  const { type, x, y, x2, y2, filled, width } = shape;
  const px = pos.x, py = pos.y;
  switch (type) {
    case 'circle': {
      const r = Math.hypot(x2 - x, y2 - y);
      const d = Math.hypot(px - x, py - y);
      return filled ? d <= r + threshold : Math.abs(d - r) <= threshold + (width || 2) / 2;
    }
    case 'rectangle': {
      const t = threshold;
      return px >= Math.min(x, x2) - t && px <= Math.max(x, x2) + t &&
             py >= Math.min(y, y2) - t && py <= Math.max(y, y2) + t;
    }
    case 'line': {
      const dx = x2 - x, dy = y2 - y, len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - x, py - y) <= threshold;
      const tt = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / len2));
      return Math.hypot(px - (x + tt * dx), py - (y + tt * dy)) <= threshold + (width || 2);
    }
    case 'cone': {
      const angle = Math.atan2(y2 - y, x2 - x);
      const len = Math.hypot(x2 - x, y2 - y);
      const spread = Math.PI / 6;
      const p1 = { x, y };
      const p2 = { x: x + Math.cos(angle - spread) * len, y: y + Math.sin(angle - spread) * len };
      const p3 = { x: x + Math.cos(angle + spread) * len, y: y + Math.sin(angle + spread) * len };
      const dX = px - p3.x, dY = py - p3.y;
      const dX21 = p3.x - p2.x, dY12 = p2.y - p3.y;
      const D = dY12 * (p1.x - p3.x) + dX21 * (p1.y - p3.y);
      const s = dY12 * dX + dX21 * dY;
      const tt = (p3.y - p1.y) * dX + (p1.x - p3.x) * dY;
      return D < 0 ? s <= 0 && tt <= 0 && s + tt >= D : s >= 0 && tt >= 0 && s + tt <= D;
    }
    default: return false;
  }
}

// ─── Floating resizable panel ────────────────────────────────────────────────
function FloatingPanel({ title, defaultPos, defaultSize, onClose, children }) {
  const [pos, setPos] = useState(defaultPos || { x: 16, y: 16 });
  const [size, setSize] = useState(defaultSize || { w: 320, h: 480 });
  const drag = useRef(false);
  const ori = useRef({});

  const startDrag = (e) => {
    if (e.button !== 0) return;
    // Ne pas démarrer le drag depuis un élément interactif
    if (e.target.closest('button, input, select, textarea, a, label')) return;
    drag.current = true;
    document.body.style.cursor = 'grabbing';
    document.documentElement.style.userSelect = 'none';
    ori.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const mv = (ev) => {
      if (!drag.current) return;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - size.w, ori.current.px + ev.clientX - ori.current.mx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, ori.current.py + ev.clientY - ori.current.my)),
      });
    };
    const up = () => {
      drag.current = false;
      document.body.style.cursor = '';
      document.documentElement.style.userSelect = '';
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  const startResize = (corner) => (e) => {
    ori.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
    const mv = (ev) => {
      const dx = ev.clientX - ori.current.mx, dy = ev.clientY - ori.current.my;
      const maxW = window.innerWidth - ori.current.px - 4;
      const maxH = window.innerHeight - ori.current.py - 4;
      if (corner === 's') setSize(s => ({ ...s, h: Math.max(180, Math.min(maxH, ori.current.h + dy)) }));
      else if (corner === 'se') setSize({ w: Math.max(240, Math.min(maxW, ori.current.w + dx)), h: Math.max(180, Math.min(maxH, ori.current.h + dy)) });
      else if (corner === 'sw') {
        const newW = Math.max(240, Math.min(ori.current.w - dx, ori.current.px + ori.current.w));
        setSize({ w: newW, h: Math.max(180, Math.min(maxH, ori.current.h + dy)) });
        setPos(p => ({ ...p, x: Math.max(0, ori.current.px + Math.min(dx, ori.current.w - 240)) }));
      }
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault(); e.stopPropagation();
  };

  // Clamp la taille effective au viewport pour ne jamais déborder
  const w = Math.min(size.w, window.innerWidth - pos.x - 4);
  const h = Math.min(size.h, window.innerHeight - pos.y - 4);

  return (
    <div
      onMouseDown={startDrag}
      style={{
        position: 'absolute', left: pos.x, top: pos.y,
        width: w, height: h,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        zIndex: 200,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'grab',
      }}
    >
      {/* En-tête — reste stylisé mais n'est plus le seul point de saisie */}
      <div style={{ padding: '7px 12px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, userSelect: 'none' }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-heading)' }}>{title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0 2px' }}>✕</button>
      </div>
      {/* Zone de contenu — curseur normal + sélection de texte réactivée */}
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '8px', cursor: 'default', userSelect: 'text' }}>
        {children}
      </div>
      <div onMouseDown={startResize('s')} style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 's-resize' }} />
      <div onMouseDown={startResize('se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'se-resize' }} />
      <div onMouseDown={startResize('sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: 14, height: 14, cursor: 'sw-resize' }} />
    </div>
  );
}

// ─── Token edit panel (draggable) ────────────────────────────────────────────
function TokenEditPanel({ token, onUpdate, onDelete, onClose, isDM, initialPos, onToggleCondition }) {
  const { token: authToken, user } = useAuth();
  const canEdit = isDM || !token.createdBy || token.createdBy === user?.id;
  const [name, setName] = useState(token.name || '');
  const [color, setColor] = useState(token.color || '#c9a84c');
  const [borderColor, setBorderColor] = useState(token.borderColor || '#ffffff');
  const [radius, setRadius] = useState(token.radius || 22);
  const [image, setImage] = useState(token.image || null);
  const [hidden, setHidden] = useState(!!token.hidden);
  const [locked, setLocked] = useState(!!token.locked);
  // visionRadius : 0 = aveugle (MJ only), 'normal' = standard, 'enhanced' = nocturne étendue
  // Fallback sur nightVision (boolean) pour les anciens tokens sans visionRadius
  const [visionRadius, setVisionRadius] = useState(
    token.visionRadius !== undefined ? token.visionRadius : (token.nightVision ? 'enhanced' : 'normal')
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  // Fix 4: position draggable
  const [pos, setPos] = useState(initialPos || { x: 8, y: 8 });
  const dragRef = useRef(false);
  const oriRef = useRef({});

  useEffect(() => {
    setName(token.name || ''); setColor(token.color || '#c9a84c'); setBorderColor(token.borderColor || '#ffffff');
    setRadius(token.radius || 22); setImage(token.image || null); setHidden(!!token.hidden);
    setLocked(!!token.locked);
    // Sync visionRadius — priorité à visionRadius, fallback sur nightVision pour les anciens tokens
    setVisionRadius(token.visionRadius !== undefined ? token.visionRadius : (token.nightVision ? 'enhanced' : 'normal'));
  }, [token.id]);

  // Repositionner quand un token différent est ouvert
  useEffect(() => { if (initialPos) setPos(initialPos); }, [token.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, textarea, a, label')) return;
    dragRef.current = true;
    document.body.style.cursor = 'grabbing';
    document.documentElement.style.userSelect = 'none';
    oriRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const mv = (ev) => {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, oriRef.current.px + ev.clientX - oriRef.current.mx),
        y: Math.max(0, oriRef.current.py + ev.clientY - oriRef.current.my),
      });
    };
    const up = () => {
      dragRef.current = false;
      document.body.style.cursor = '';
      document.documentElement.style.userSelect = '';
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  const handleFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('image', f);
      const res = await fetch(`${API}/maps/token-image`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd });
      if (res.ok) { const data = await res.json(); setImage(`${VITE_API}${data.path}`); }
    } catch { /* ignore */ }
    setUploading(false);
  };
  const apply = () => onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius, nightVision: visionRadius === 'enhanced' });
  // Met à jour visionRadius et synchronise nightVision (rétrocompat) en un seul appel
  const updateVision = (vr) => {
    setVisionRadius(vr);
    onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius: vr, nightVision: vr === 'enhanced' });
  };

  return (
    <div style={{ position: 'absolute', left: pos.x, top: pos.y, width: 240, background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)', zIndex: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.7)', padding: '10px' }}>
      {/* En-tête draggable */}
      <div onMouseDown={startDrag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', cursor: 'grab', userSelect: 'none' }}>
        <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}>Modifier token</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {token.createdByName && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Créé par {token.createdByName}</span>
        )}
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nom" style={{ fontSize: '0.82rem', padding: '4px 7px' }} onKeyDown={e => e.key === 'Enter' && canEdit && apply()} disabled={!canEdit} />
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', fontSize: '0.78rem' }}>
          <label style={{ color: 'var(--text-muted)' }}>Fond</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '26px', height: '22px', padding: 0, border: 'none', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4 }} disabled={!canEdit} />
          <label style={{ color: 'var(--text-muted)' }}>Bord.</label>
          <input type="color" value={borderColor} onChange={e => setBorderColor(e.target.value)} style={{ width: '26px', height: '22px', padding: 0, border: 'none', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4 }} disabled={!canEdit} />
          <label style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>Rayon px</label>
          <input type="number" value={radius} onChange={e => setRadius(Number(e.target.value))} min={10} max={120} style={{ width: '50px', padding: '3px 5px', fontSize: '0.8rem' }} disabled={!canEdit} />
        </div>
        {image && <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><img src={image} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />{canEdit && <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.72rem' }} onClick={() => setImage(null)}>✕</button>}</div>}
        {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()} disabled={uploading} style={{ fontSize: '0.78rem' }}>🖼️ {uploading ? '...' : (image ? 'Changer' : 'Upload image')}</button>}
        <input ref={fileRef} type="file" accept="image/*,.jfif" onChange={handleFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
          <button className="btn btn-primary btn-sm" onClick={apply} style={{ flex: 1, fontSize: '0.8rem' }} disabled={!canEdit}>Appliquer</button>
          {(isDM || canEdit) && <button className="btn btn-danger btn-sm" onClick={onDelete} title="Supprimer (Suppr)">🗑️</button>}
        </div>
        {isDM && (
          <>
            {/* Fix 1 : boutons sur une seule ligne — gap + padding compacts pour tenir dans 240px */}
            <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
              <button
                className={`btn btn-sm ${hidden ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = !hidden; setHidden(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden: next, locked, visionRadius, nightVision: visionRadius === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
              >{hidden ? '👁️ Révéler' : '🙈 Masquer'}</button>
              <button
                className={`btn btn-sm ${locked ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = !locked; setLocked(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked: next, visionRadius, nightVision: visionRadius === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
              >{locked ? '🔓 Déverr.' : '🔒 Verr.'}</button>
              <button
                className={`btn btn-sm ${visionRadius === 'enhanced' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = visionRadius === 'enhanced' ? 'normal' : 'enhanced'; setVisionRadius(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius: next, nightVision: next === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
                title="Vision nocturne — radius de vision étendu à 6 cases"
              >{visionRadius === 'enhanced' ? '🌙 Nuit ✓' : '🌙 Nuit'}</button>
            </div>
          </>
        )}
        {/* Sélecteur Vision compact : boutons colorés sur une ligne, sans débordement */}
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
            <span style={{ fontSize: '11px', color: '#aaa', flexShrink: 0 }}>Vision :</span>
            <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
              {/* Aveugle : MJ uniquement — le joueur ne peut pas lever cette restriction */}
              {isDM && (
                <button
                  onClick={() => updateVision(0)}
                  style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 0 ? '#c0392b' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}
                >🚫 Aveugle</button>
              )}
              {/* Normal — désactivé pour les joueurs si le MJ a posé Aveugle */}
              <button
                onClick={() => updateVision('normal')}
                disabled={visionRadius === 0 && !isDM}
                style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 'normal' ? '#2d6a4f' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: visionRadius === 0 && !isDM ? 'not-allowed' : 'pointer', color: '#fff', opacity: visionRadius === 0 && !isDM ? 0.4 : 1 }}
              >Normal</button>
              {/* Étendu — désactivé pour les joueurs si le MJ a posé Aveugle */}
              <button
                onClick={() => updateVision('enhanced')}
                disabled={visionRadius === 0 && !isDM}
                style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 'enhanced' ? '#1a4a8a' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: visionRadius === 0 && !isDM ? 'not-allowed' : 'pointer', color: '#fff', opacity: visionRadius === 0 && !isDM ? 0.4 : 1 }}
              >Étendu</button>
            </div>
          </div>
        )}
        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textAlign: 'center' }}>Suppr pour effacer • Glisser coin pour redimensionner</span>

        {/* Section Conditions — accessible à tous (MJ et joueur propriétaire) */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '6px', marginTop: '2px' }}>
          <span style={{ fontSize: '0.72rem', color: '#aaa', display: 'block', marginBottom: '4px' }}>Conditions</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {CONDITIONS.map(condition => {
              const active = token.conditions?.includes(condition.id);
              return (
                <button
                  key={condition.id}
                  onClick={() => onToggleCondition(token.id, condition.id)}
                  title={condition.label}
                  style={{
                    padding: '2px 5px', fontSize: '13px', borderRadius: '4px',
                    border: `1px solid ${active ? condition.color : '#555'}`,
                    background: active ? condition.color : 'transparent',
                    cursor: 'pointer', opacity: active ? 1 : 0.35,
                    transition: 'opacity 0.15s, background 0.15s',
                  }}
                >
                  {condition.emoji}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapCanvas({ sessionId, isDM }) {
  const socket = useSocket();
  const { token, user } = useAuth();
  const canvasRef = useRef(null);
  const cursorCanvasRef = useRef(null); // Canvas dédié aux curseurs — positionné après les tokens dans le DOM
  const containerRef = useRef(null);

  // ── Operation flags ──
  const fogPainting = useRef(false);
  const eraserActive = useRef(false);
  const resizingToken = useRef(null);
  const dragMoved = useRef(false);
  const lastDragEmit = useRef(0);
  const lastCursorEmit = useRef(0);
  const lastDrawEmit = useRef(0);
  const lastFogEmit = useRef(0);
  const lastImgTransformEmit = useRef(0); // Feature 2 — throttle du broadcast live image transform
  const panStartRef = useRef({ x: 0, y: 0 }); // avoids re-renders during panning
  const pingAnimRef = useRef([]);
  const lerpAnimRef = useRef(null);
  const tokenLastClickRef = useRef({ id: null, time: 0 });
  const fetchMapsRef = useRef(null);
  // Sync flags — updated synchronously so mousemove handlers are never stale
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isDraggingRef = useRef(null);  // stores the token object being dragged

  // ── Draw data refs (always fresh for synchronous drawFrame calls) ──
  const tokensRef = useRef([]);
  const tokenVisualsRef = useRef({});   // interpolated display positions per token id
  const tokenLerpsRef = useRef({});   // active lerp jobs { fromX,fromY,toX,toY,startTime,duration }
  const cursorVisualsRef = useRef({});   // interpolated cursor positions { userId: {x,y} }
  const cursorLerpsRef = useRef({});   // cursor lerp jobs (same shape as tokenLerpsRef)
  const pathsRef = useRef([]);
  const livePathsRef = useRef({});   // other users' in-progress strokes { pathId: {color,width,points[]} }
  const currentPathRef = useRef([]);
  const currentPathIdRef = useRef(null); // id shared with finalized path
  const selectedTokenRef = useRef(null);
  const panOffsetRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const mapImageRef = useRef(null);
  const imgXRef = useRef(0);
  const imgYRef = useRef(0);
  const imgScaleRef = useRef(1);
  const gridSizeRef = useRef(40);
  const drawColorRef = useRef('#ef4444');
  const drawWidthRef = useRef(2);
  const fogColorRef = useRef('#000000');
  const fogOpacityRef = useRef(0.85);
  const fogCellsRef = useRef(new Set());
  const fogBrushPxRef = useRef(40);
  const isDMRef = useRef(isDM);
  const activeMapRef = useRef(null);
  const otherCursorsRef = useRef({});
  const toolRef = useRef('move');
  const copiedTokenRef = useRef(null);   // token copié via Ctrl+C
  const mouseWorldPosRef = useRef({ x: 0, y: 0 }); // position monde courante de la souris
  const undoStackRef = useRef([]);       // pile d'annulation (max 20 entrées)
  const redoStackRef = useRef([]);       // pile de rétablissement
  // ── Formes de sorts ──
  const shapesRef = useRef([]);          // formes sauvegardées
  const currentShapeRef = useRef(null); // forme en cours de dessin (preview live)
  const selectedShapeRef = useRef(null); // forme actuellement sélectionnée
  const isDrawingShapeRef = useRef(false);
  const shapeTypeRef = useRef('circle');
  const shapeColorRef = useRef('#e74c3c');
  const shapeWidthRef = useRef(2);
  const shapeFilledRef = useRef(true);
  const shapeOpacityRef = useRef(0.5);
  // ── Fog simplifié — un seul état : fogCellsRef (peint par le MJ) ──
  const lastFogUpdateRef = useRef(0); // throttle du recalcul fog pendant drag (50ms)
  // ── React state (drives re-render / UI only) ──
  const [maps, setMaps] = useState([]);
  const [activeMap, setActiveMap] = useState(null);
  const [mapImage, setMapImage] = useState(null);
  const [imgX, setImgX] = useState(0);
  const [imgY, setImgY] = useState(0);
  const [imgScale, setImgScale] = useState(1);
  const [tokens, setTokens] = useState([]);
  const [paths, setPaths] = useState([]);
  const [fogCells, setFogCells] = useState(new Set());
  const [tool, setTool] = useState('move');
  const [gridSize, setGridSize] = useState(40);
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawWidth, setDrawWidth] = useState(2);
  const [eraserSize, setEraserSize] = useState(20);
  const [fogBrushPx, setFogBrushPx] = useState(40);
  const [fogColor, setFogColor] = useState('#000000');
  const [fogOpacity, setFogOpacity] = useState(0.85);
  // Toggle visibilité de la grille
  const [showGrid, setShowGrid] = useState(true);
  const showGridRef = useRef(true);
  const [drawing, setDrawing] = useState(false);
  const [dragging, setDragging] = useState(null);
  const [editingMapImg, setEditingMapImg] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'token'|'map-image', id? }
  const [zoom, setZoom] = useState(1);
  const [selectedToken, setSelectedToken] = useState(null);
  const [showTokenEdit, setShowTokenEdit] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [showCombat, setShowCombat] = useState(false);
  const [editingMapName, setEditingMapName] = useState(null); // Feature 5 — null = pas en édition, string = en cours
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenColor, setNewTokenColor] = useState('#c9a84c');
  const [newTokenBorderColor, setNewTokenBorderColor] = useState('#ffffff');
  const [newTokenRadius, setNewTokenRadius] = useState(20);
  const newTokenFileRef = useRef();
  const prevMapIdRef = useRef(null); // garde contre rechargement de map sur simple rename
  const tokenWorldRef = useRef(null); // overlay transform (sync pan/zoom canvas)
  const tokenDivsRef = useRef({});   // map id→div pour updates impératifs pendant lerp
  const mapWorldRef = useRef(null);  // div transform pour la map HTML (même espace que tokenWorld)
  const mapImgElemRef = useRef(null); // <img> DOM de la map background
  const [newTokenImage, setNewTokenImage] = useState(null);
  const [newTokenHidden, setNewTokenHidden] = useState(false);
  const [tokenEditPos, setTokenEditPos] = useState(null); // position initiale du panneau d'édition de token
  // ── Formes de sorts ──
  const [shapes, setShapes] = useState([]);
  const [selectedShape, setSelectedShape] = useState(null);
  const [shapeType, setShapeType] = useState('circle');
  const [shapeColor, setShapeColor] = useState('#e74c3c');
  const [shapeWidth, setShapeWidth] = useState(2);
  const [shapeFilled, setShapeFilled] = useState(true);
  const [shapeOpacity, setShapeOpacity] = useState(0.5);

  // ── Keep refs in sync with state ──
  useEffect(() => { if (!isDraggingRef.current) tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { mapImageRef.current = mapImage; }, [mapImage]);
  useEffect(() => { imgXRef.current = imgX; imgYRef.current = imgY; imgScaleRef.current = imgScale; }, [imgX, imgY, imgScale]);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { drawWidthRef.current = drawWidth; }, [drawWidth]);
  useEffect(() => { fogColorRef.current = fogColor; }, [fogColor]);
  useEffect(() => { fogOpacityRef.current = fogOpacity; }, [fogOpacity]);
  useEffect(() => { fogBrushPxRef.current = fogBrushPx; }, [fogBrushPx]);
  useEffect(() => { fogCellsRef.current = fogCells; }, [fogCells]);
  useEffect(() => { isDMRef.current = isDM; }, [isDM]);
  useEffect(() => { activeMapRef.current = activeMap; }, [activeMap]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedTokenRef.current = selectedToken; }, [selectedToken]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { shapeTypeRef.current = shapeType; }, [shapeType]);
  useEffect(() => { shapeColorRef.current = shapeColor; }, [shapeColor]);
  useEffect(() => { shapeWidthRef.current = shapeWidth; }, [shapeWidth]);
  useEffect(() => { shapeFilledRef.current = shapeFilled; }, [shapeFilled]);
  useEffect(() => { shapeOpacityRef.current = shapeOpacity; }, [shapeOpacity]);
  useEffect(() => { selectedShapeRef.current = selectedShape; }, [selectedShape]);

  // ─────────────────────────────────────────────────────────────────────────
  // drawFrame — reads ONLY refs, never state → safe to call synchronously
  // ─────────────────────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cont = containerRef.current;
    if (cont && (canvas.width !== cont.clientWidth || canvas.height !== cont.clientHeight)) {
      canvas.width = cont.clientWidth; canvas.height = cont.clientHeight;
    }
    if (!canvas.width || !canvas.height) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pan = panOffsetRef.current;
    const z = zoomRef.current;
    const gs = gridSizeRef.current;
    const img = mapImageRef.current;
    const dm = isDMRef.current;
    const fc = fogCellsRef.current;

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(z, z);
    const W = canvas.width / z, H = canvas.height / z, wx0 = -pan.x / z, wy0 = -pan.y / z;

    // Sync overlay divs avec le canvas (pan + zoom) — même transform pour map et tokens
    const overlayTfm = `translate(${pan.x}px,${pan.y}px) scale(${z})`;
    if (tokenWorldRef.current) tokenWorldRef.current.style.transform = overlayTfm;
    if (mapWorldRef.current) mapWorldRef.current.style.transform = overlayTfm;

    // Canvas fond transparent — le fond #1c2033 vient du CSS container
    // La map image est rendue comme <img> HTML dans mapWorldRef (animation GIF native)
    if (img && mapImgElemRef.current) {
      const iw = img.naturalWidth * imgScaleRef.current;
      const ih = img.naturalHeight * imgScaleRef.current;
      mapImgElemRef.current.style.left = `${imgXRef.current}px`;
      mapImgElemRef.current.style.top = `${imgYRef.current}px`;
      mapImgElemRef.current.style.width = `${iw}px`;
      mapImgElemRef.current.style.height = `${ih}px`;
      if (dm && toolRef.current === 'map-edit') {
        const ix = imgXRef.current, iy = imgYRef.current;
        ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 3 / z]);
        ctx.strokeRect(ix, iy, iw, ih); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(96,165,250,0.18)'; ctx.fillRect(ix + 2 / z, iy + 2 / z, iw - 4 / z, ih - 4 / z);
        [[ix, iy], [ix + iw, iy], [ix + iw, iy + ih], [ix, iy + ih]].forEach(([hx, hy]) => {
          ctx.beginPath(); ctx.arc(hx, hy, 8 / z, 0, Math.PI * 2); ctx.fillStyle = '#60a5fa'; ctx.fill();
        });
      }
    }

    // Grille — toujours dessinée avant le fog ; le fog la recouvrira dans les zones fogées
    if (showGridRef.current) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5 / z;
      const gx0 = Math.floor(wx0 / gs) * gs, gy0 = Math.floor(wy0 / gs) * gs;
      for (let x = gx0; x <= wx0 + W + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, gy0 - gs); ctx.lineTo(x, wy0 + H + gs); ctx.stroke(); }
      for (let y = gy0; y <= wy0 + H + gs; y += gs) { ctx.beginPath(); ctx.moveTo(gx0 - gs, y); ctx.lineTo(wx0 + W + gs, y); ctx.stroke(); }
    }

    // Saved drawings
    pathsRef.current.forEach(path => {
      if (!path.points || path.points.length < 2) return;
      ctx.strokeStyle = path.color || '#ef4444'; ctx.lineWidth = (path.width || 2) / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    });

    // Live paths (other users drawing right now)
    Object.values(livePathsRef.current).forEach(lp => {
      if (!lp.points || lp.points.length < 2) return;
      ctx.strokeStyle = lp.color || '#ef4444'; ctx.lineWidth = (lp.width || 2) / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(lp.points[0].x, lp.points[0].y);
      lp.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    });

    // Current in-progress path (local user)
    const cp = currentPathRef.current;
    if (cp.length > 1) {
      ctx.strokeStyle = drawColorRef.current; ctx.lineWidth = drawWidthRef.current / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(cp[0].x, cp[0].y); cp.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    }

    // Anneaux et handles de sélection → rendu en CSS (box-shadow) dans le token overlay HTML
    // pour éviter qu'ils soient cachés sous les divs HTML à z-index supérieur

    // ─── Fog simplifié : 2 états uniquement — fogCellsRef (80%) ou rien ─────
    // Path2D fusionne toutes les cellules adjacentes en un seul tracé avant ctx.fill(),
    // ce qui évite les légères variations d'opacité entre cellules qui créaient un effet de quadrillage.
    if (dm) {
      // MJ : fog semi-transparent (voit toujours tout) + cercles de vision debug
      if (fc.size > 0) {
        const hex = fogColorRef.current.replace('#', '');
        const fr = parseInt(hex.slice(0, 2), 16), fg = parseInt(hex.slice(2, 4), 16), fb = parseInt(hex.slice(4, 6), 16);
        // Construire un Path2D unique : cellules fusionnées, limitées aux bounds de l'image
        const fogPath = new Path2D();
        const fImg = mapImageRef.current;
        const fLeft   = fImg ? imgXRef.current : -Infinity;
        const fRight  = fImg ? imgXRef.current + fImg.naturalWidth  * imgScaleRef.current : Infinity;
        const fTop    = fImg ? imgYRef.current : -Infinity;
        const fBottom = fImg ? imgYRef.current + fImg.naturalHeight * imgScaleRef.current : Infinity;
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          const px = cx * gs, py = cy * gs;
          // Exclure les cellules hors bounds de la map (ne peuvent pas exister mais sécurité défensive)
          if (px + gs > fLeft && px < fRight && py + gs > fTop && py < fBottom)
            fogPath.rect(px, py, gs, gs);
        });
        // Un seul fill() = opacité uniforme, pas de bordures entre cellules adjacentes
        ctx.fillStyle = `rgba(${fr},${fg},${fb},${Math.min(fogOpacityRef.current, 0.65)})`;
        ctx.fill(fogPath);
      }
      // Cercles de vision des tokens joueurs — aide le MJ à visualiser les zones révélées
      if (gs > 0) {
        tokensRef.current.forEach(tok => {
          if (tok.hidden || tok.type === 'enemy') return;
          const vr = (tok.nightVision ? VISION_ENHANCED : VISION_NORMAL) * gs;
          ctx.beginPath(); ctx.arc(tok.x, tok.y, vr, 0, Math.PI * 2);
          ctx.strokeStyle = tok.nightVision ? 'rgba(160,80,255,0.55)' : 'rgba(255,220,80,0.45)';
          ctx.lineWidth = 1.5 / z; ctx.setLineDash([5 / z, 4 / z]); ctx.stroke(); ctx.setLineDash([]);
        });
      }
    } else if (gs > 0 && fc.size > 0) {
      // Joueurs : fog opaque à 80%, limité aux bounds de l'image de la map
      // Path2D unique = un seul ctx.fill() → pas d'effet grille entre cellules adjacentes
      const fogPath = new Path2D();
      const img = mapImageRef.current;
      if (img) {
        const imgLeft   = imgXRef.current;
        const imgTop    = imgYRef.current;
        const imgRight  = imgLeft + img.naturalWidth  * imgScaleRef.current;
        const imgBottom = imgTop  + img.naturalHeight * imgScaleRef.current;
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          const px = cx * gs, py = cy * gs;
          // Inclure uniquement les cellules dans les bounds de l'image
          if (px + gs > imgLeft && px < imgRight && py + gs > imgTop && py < imgBottom)
            fogPath.rect(px, py, gs, gs);
        });
      } else {
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          fogPath.rect(cx * gs, cy * gs, gs, gs);
        });
      }
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fill(fogPath);
    }

    // ─── Formes de sorts ─────────────────────────────────────────────────────
    // Dessinées après le fog — toujours visibles (zones de sorts intentionnellement placées)
    const drawShape = (shape, isSelected) => {
      if (shape.x2 === undefined || shape.y2 === undefined) return;
      ctx.save();
      ctx.globalAlpha = shape.opacity ?? 0.5;
      ctx.strokeStyle = shape.color || '#e74c3c';
      ctx.lineWidth = (shape.width || 2) / z;
      ctx.fillStyle = shape.color || '#e74c3c';
      if (isSelected) { ctx.shadowColor = '#facc15'; ctx.shadowBlur = 10 / z; }
      ctx.beginPath();
      switch (shape.type) {
        case 'circle': {
          const radius = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
          ctx.arc(shape.x, shape.y, radius, 0, Math.PI * 2);
          if (shape.filled) ctx.fill(); ctx.stroke(); break;
        }
        case 'rectangle':
          ctx.rect(shape.x, shape.y, shape.x2 - shape.x, shape.y2 - shape.y);
          if (shape.filled) ctx.fill(); ctx.stroke(); break;
        case 'line':
          ctx.moveTo(shape.x, shape.y); ctx.lineTo(shape.x2, shape.y2); ctx.stroke(); break;
        case 'cone': {
          const angle = Math.atan2(shape.y2 - shape.y, shape.x2 - shape.x);
          const length = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
          const spread = Math.PI / 6;
          ctx.moveTo(shape.x, shape.y);
          ctx.lineTo(shape.x + Math.cos(angle - spread) * length, shape.y + Math.sin(angle - spread) * length);
          ctx.lineTo(shape.x + Math.cos(angle + spread) * length, shape.y + Math.sin(angle + spread) * length);
          ctx.closePath();
          if (shape.filled) ctx.fill(); ctx.stroke(); break;
        }
      }
      ctx.restore();
    };
    shapesRef.current.forEach(s => drawShape(s, s.id === selectedShapeRef.current?.id));
    if (currentShapeRef.current) drawShape(currentShapeRef.current, false);

    // ─── Conditions des tokens ────────────────────────────────────────────────
    // Icônes de conditions en arc de cercle sous chaque token visible
    tokensRef.current.forEach(tok => {
      if (!tok.conditions?.length) return;
      if (!dm && tok.hidden) return;
      if (!dm && gs > 0) {
        const cellKey = `${Math.floor(tok.x / gs)},${Math.floor(tok.y / gs)}`;
        if (fc.has(cellKey)) return;
      }
      const conds = tok.conditions.map(id => CONDITIONS.find(c => c.id === id)).filter(Boolean);
      if (!conds.length) return;
      const vis = tokenVisualsRef.current[tok.id];
      const tx = vis?.x ?? tok.x, ty = vis?.y ?? tok.y;
      const r = clamp(tok.radius || 22, 10, 120);
      const iconR = 7 / z; // rayon icône = 7px écran
      const startAngle = Math.PI * 0.2, endAngle = Math.PI * 0.8;
      conds.forEach((cond, i) => {
        const angle = conds.length === 1
          ? Math.PI * 0.5
          : startAngle + (endAngle - startAngle) * (i / (conds.length - 1));
        const cx = tx + Math.cos(angle) * (r + iconR * 2.2);
        const cy = ty + Math.sin(angle) * (r + iconR * 2.2);
        ctx.beginPath(); ctx.arc(cx, cy, iconR, 0, Math.PI * 2);
        ctx.fillStyle = cond.color; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5 / z; ctx.stroke();
        ctx.font = `${11 / z}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cond.emoji, cx, cy);
      });
    });

    // Ping animations — ease-out with 3 rings + impact dot (avant les curseurs)
    const now = Date.now();
    pingAnimRef.current = pingAnimRef.current.filter(p => now - p.ts < 2000);
    pingAnimRef.current.forEach(p => {
      const age = (now - p.ts) / 2000;
      const ease = 1 - Math.pow(1 - age, 2); // ease-out
      // Outer ring
      ctx.strokeStyle = `rgba(250,204,21,${(1 - age) * 0.6})`; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (22 + ease * 65) / z, 0, Math.PI * 2); ctx.stroke();
      // Middle ring
      ctx.strokeStyle = `rgba(250,204,21,${(1 - age) * 0.85})`; ctx.lineWidth = 3 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (12 + ease * 38) / z, 0, Math.PI * 2); ctx.stroke();
      // Inner ring
      ctx.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.7})`; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (6 + ease * 18) / z, 0, Math.PI * 2); ctx.stroke();
      // Impact dot (first 25% of animation)
      if (age < 0.25) { const ia = age / 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, (7 * (1 - ia)) / z, 0, Math.PI * 2); ctx.fillStyle = `rgba(250,204,21,${1 - ia})`; ctx.fill(); }
    });
    if (pingAnimRef.current.length > 0) requestAnimationFrame(drawFrame);

    ctx.restore();

    // Curseurs — dessinés sur un canvas dédié (cursorCanvasRef) positionné APRÈS les tokens dans le DOM.
    // Ce canvas a un z-index supérieur aux tokens HTML : les curseurs apparaissent toujours au-dessus.
    // Dessiner les curseurs sur le canvas principal ne fonctionnerait pas car les divs token HTML
    // sont dans une couche DOM supérieure, indépendamment de l'ordre dans drawFrame().
    const cc = cursorCanvasRef.current;
    if (cc) {
      if (cc.width !== canvas.width) cc.width = canvas.width;
      if (cc.height !== canvas.height) cc.height = canvas.height;
      const cCtx = cc.getContext('2d');
      cCtx.clearRect(0, 0, cc.width, cc.height);
      cCtx.save();
      cCtx.translate(pan.x, pan.y);
      cCtx.scale(z, z);
      Object.values(otherCursorsRef.current).forEach(c => {
        const vis = cursorVisualsRef.current[c.userId];
        const cx = vis?.x ?? c.x, cy = vis?.y ?? c.y;
        // Curseur du MJ invisible pour les joueurs — les joueurs ne savent pas où regarde le MJ
        if (!dm && c.isDM) return;
        // Curseurs cachés dans le fog pour les joueurs
        if (!dm) {
          const cellKey = `${Math.floor(cx / gs)},${Math.floor(cy / gs)}`;
          if (fc.has(cellKey)) return;
        }
        const col = userColor(c.userId);
        cCtx.fillStyle = col;
        cCtx.beginPath(); cCtx.moveTo(cx, cy); cCtx.lineTo(cx + 12 / z, cy + 4 / z); cCtx.lineTo(cx + 4 / z, cy + 12 / z); cCtx.closePath(); cCtx.fill();
        cCtx.strokeStyle = 'rgba(0,0,0,0.5)'; cCtx.lineWidth = 0.5 / z; cCtx.stroke();
        cCtx.fillStyle = col; cCtx.font = `bold ${9 / z}px Inter,sans-serif`; cCtx.textAlign = 'left'; cCtx.textBaseline = 'top';
        cCtx.fillText(c.username, cx + 14 / z, cy + 4 / z);
      });
      cCtx.restore();
    }
  }, []); // ← empty deps: all data comes from refs

  // ─── Token interpolation loop ─────────────────────────────────────────────
  const startLerpAnimation = useCallback(() => {
    if (lerpAnimRef.current) return;
    const animate = () => {
      const now = Date.now();
      let active = false;
      Object.entries(tokenLerpsRef.current).forEach(([id, tgt]) => {
        const t = Math.min((now - tgt.startTime) / tgt.duration, 1);
        tokenVisualsRef.current[id] = { x: lerp(tgt.fromX, tgt.toX, t), y: lerp(tgt.fromY, tgt.toY, t) };
        if (t < 1) active = true;
        else delete tokenLerpsRef.current[id];
      });
      // Cursor lerp — same pattern as tokens
      Object.entries(cursorLerpsRef.current).forEach(([uid, tgt]) => {
        const t = Math.min((now - tgt.startTime) / tgt.duration, 1);
        cursorVisualsRef.current[uid] = { x: lerp(tgt.fromX, tgt.toX, t), y: lerp(tgt.fromY, tgt.toY, t) };
        if (t < 1) active = true;
        else delete cursorLerpsRef.current[uid];
      });
      // Sync token overlay div positions (impératif, sans re-render React)
      Object.entries(tokenVisualsRef.current).forEach(([id, vis]) => {
        const el = tokenDivsRef.current[id];
        if (!el) return;
        const tok = tokensRef.current.find(t => t.id === id);
        if (!tok) return;
        const r = clamp(tok.radius || 22, 10, 120);
        el.style.left = `${vis.x - r}px`;
        el.style.top = `${vis.y - r}px`;
      });
      drawFrame();
      lerpAnimRef.current = active ? requestAnimationFrame(animate) : null;
    };
    lerpAnimRef.current = requestAnimationFrame(animate);
  }, [drawFrame]);

  // ─── ResizeObserver: initial draw when container gets its size ───────────
  useEffect(() => {
    const c = containerRef.current; if (!c) return;
    const obs = new ResizeObserver(() => drawFrame());
    obs.observe(c);
    return () => obs.disconnect();
  }, [drawFrame]);

  // Redraw on state changes (shapes et selectedShape inclus pour les conditions et formes)
  useEffect(() => { drawFrame(); }, [tokens, paths, shapes, selectedShape, panOffset, zoom, mapImage, imgX, imgY, imgScale, fogCells, gridSize, drawColor, drawWidth, fogColor, fogOpacity, tool, drawFrame]);

  // Révèle le fog MJ dans le radius d'un token joueur — retire les cellules de fogCellsRef.
  // Cercle parfait : tolérance +0.5 pour inclure les cellules tangentes au bord du rayon.
  const revealFogForToken = (tok) => {
    const gs = gridSizeRef.current;
    // Fix 3 : tokens cachés ou aveugles (visionRadius === 0) n'effacent jamais le fog
    if (gs <= 0 || !tok || tok.hidden || tok.type === 'enemy' || tok.visionRadius === 0) return [];
    const removed = [];
    // Rayon : 'enhanced' ou nightVision (rétrocompat anciens tokens) → 6 cases, sinon 3 cases
    const vr = (tok.visionRadius === 'enhanced' || (tok.visionRadius === undefined && tok.nightVision)) ? VISION_ENHANCED : VISION_NORMAL;
    const tcx = Math.floor(tok.x / gs);
    const tcy = Math.floor(tok.y / gs);
    for (let dx = -vr; dx <= vr; dx++) {
      for (let dy = -vr; dy <= vr; dy++) {
        if (Math.sqrt(dx * dx + dy * dy) <= vr + 0.5) {
          const key = `${tcx + dx},${tcy + dy}`;
          if (fogCellsRef.current.has(key)) {
            fogCellsRef.current.delete(key);
            removed.push(key);
          }
        }
      }
    }
    return removed;
  };

  // Sauvegarde l'état courant avant une mutation pour permettre l'annulation
  const saveUndoState = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current) }
    ];
    redoStackRef.current = [];
  };

  // Delete key / Ctrl+C / Ctrl+V / Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e) => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;

      // Ctrl+C — copier le token sélectionné
      if (e.ctrlKey && e.key === 'c') {
        if (selectedTokenRef.current) copiedTokenRef.current = { ...selectedTokenRef.current };
        return;
      }

      // Ctrl+V — coller le token copié à la position courante de la souris
      if (e.ctrlKey && e.key === 'v') {
        if (!copiedTokenRef.current) return;
        e.preventDefault();
        saveUndoState();
        const { x, y } = mouseWorldPosRef.current;
        const newToken = { ...copiedTokenRef.current, id: crypto.randomUUID(), x, y, hidden: false };
        tokensRef.current = [...tokensRef.current, newToken];
        setTokens([...tokensRef.current]);
        drawFrame();
        if (socket) socket.emit('map-token-add', { sessionId, mapId: activeMapRef.current?.id, token: newToken, allTokens: tokensRef.current });
        return;
      }

      // Ctrl+Z — annuler la dernière action locale
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        if (undoStackRef.current.length === 0) return;
        const current = { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current) };
        redoStackRef.current = [...redoStackRef.current.slice(-19), current];
        const prev = undoStackRef.current[undoStackRef.current.length - 1];
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        tokensRef.current = prev.tokens; setTokens(prev.tokens);
        pathsRef.current = prev.drawings; setPaths(prev.drawings);
        fogCellsRef.current = prev.fogCells; setFogCells(prev.fogCells);
        drawFrame();
        if (socket && activeMapRef.current) {
          socket.emit('map-token-add', { sessionId, mapId: activeMapRef.current.id, allTokens: prev.tokens });
          socket.emit('map-drawings-clear', { sessionId, mapId: activeMapRef.current.id });
          prev.drawings.forEach(p => socket.emit('map-drawing', { sessionId, mapId: activeMapRef.current.id, path: p }));
          socket.emit('map-fog-paint', { sessionId, mapId: activeMapRef.current.id, fogCells: Array.from(prev.fogCells), gridSize: gridSizeRef.current });
        }
        return;
      }

      // Ctrl+Y — rétablir l'action annulée
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        if (redoStackRef.current.length === 0) return;
        const current = { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current) };
        undoStackRef.current = [...undoStackRef.current.slice(-19), current];
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        tokensRef.current = next.tokens; setTokens(next.tokens);
        pathsRef.current = next.drawings; setPaths(next.drawings);
        fogCellsRef.current = next.fogCells; setFogCells(next.fogCells);
        drawFrame();
        if (socket && activeMapRef.current) {
          socket.emit('map-token-add', { sessionId, mapId: activeMapRef.current.id, allTokens: next.tokens });
          socket.emit('map-drawings-clear', { sessionId, mapId: activeMapRef.current.id });
          next.drawings.forEach(p => socket.emit('map-drawing', { sessionId, mapId: activeMapRef.current.id, path: p }));
          socket.emit('map-fog-paint', { sessionId, mapId: activeMapRef.current.id, fogCells: Array.from(next.fogCells), gridSize: gridSizeRef.current });
        }
        return;
      }

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      // Map-edit mode: Delete clears the background image (with confirmation)
      if (toolRef.current === 'map-edit' && isDMRef.current && mapImageRef.current) {
        e.preventDefault();
        setPendingDelete({ type: 'map-image' });
        return;
      }
      if (selectedTokenRef.current) {
        e.preventDefault();
        setPendingDelete({ type: 'token', id: selectedTokenRef.current.id, name: selectedTokenRef.current.name });
        return;
      }
      // Suppression d'une forme sélectionnée — créateur ou MJ uniquement
      if (selectedShapeRef.current) {
        const shape = selectedShapeRef.current;
        if (isDMRef.current || shape.createdBy === user?.id) {
          e.preventDefault();
          const next = shapesRef.current.filter(s => s.id !== shape.id);
          shapesRef.current = next; setShapes(next);
          selectedShapeRef.current = null; setSelectedShape(null);
          drawFrame();
          if (socket && activeMapRef.current)
            socket.emit('map-shape-delete', { sessionId, mapId: activeMapRef.current.id, shapeId: shape.id });
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [socket, sessionId, drawFrame]);

  // ─── Socket listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // Reconnexion détectée : rafraîchir la liste des maps (nouvelles maps ajoutées pendant la coupure).
    // L'état volatile (tokens, fog, tracés) est récupéré via map-sync, envoyé par le serveur dans join-session.
    const hasConnectedRef = { current: socket.connected };
    const onConnect = () => {
      if (hasConnectedRef.current) fetchMapsRef.current?.();
      hasConnectedRef.current = true;
    };
    socket.on('connect', onConnect);

    // Réception de l'état complet de la map active après (re)connexion.
    // Le serveur envoie cet événement dans join-session pour chaque socket qui rejoint la session.
    // Applique directement les tokens/tracés/fog/grille/image sans reload de page.
    const onMapSync = ({ mapId, tokens: t, drawings: d, shapes: shps, fogCells: fc, gridSize: gs, img_x, img_y, img_scale }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const toks = Array.isArray(t) ? t : [];
      tokensRef.current = toks; setTokens(toks);
      const pths = Array.isArray(d) ? d : [];
      pathsRef.current = pths; setPaths(pths);
      const shapeList = Array.isArray(shps) ? shps : [];
      shapesRef.current = shapeList; setShapes(shapeList);
      const cells = new Set(Array.isArray(fc) ? fc : []);
      fogCellsRef.current = cells; setFogCells(cells);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
      if (img_x !== undefined) { setImgX(img_x); setImgY(img_y); setImgScale(img_scale); }
      livePathsRef.current = {};
      drawFrame();
    };
    socket.on('map-sync', onMapSync);

    const onTokenUpdate = ({ mapId, tokens: t, live }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const parsed = typeof t === 'string' ? JSON.parse(t) : (t || []);
      if (live) {
        // Start interpolation toward new positions (smooth movement)
        parsed.forEach(tk => {
          const vis = tokenVisualsRef.current[tk.id];
          tokenLerpsRef.current[tk.id] = { fromX: vis?.x ?? tk.x, fromY: vis?.y ?? tk.y, toX: tk.x, toY: tk.y, startTime: Date.now(), duration: 80 };
        });
        startLerpAnimation();
      } else {
        // Final position — snap visual to actual
        parsed.forEach(tk => { tokenVisualsRef.current[tk.id] = { x: tk.x, y: tk.y }; });
        drawFrame();
      }
      tokensRef.current = parsed; setTokens(parsed);
    };

    // Live drawing segment from another user
    const onLiveDrawing = ({ mapId, pathId, point, color, width }) => {
      if (mapId !== activeMapRef.current?.id) return;
      if (!livePathsRef.current[pathId]) livePathsRef.current[pathId] = { color, width, points: [] };
      livePathsRef.current[pathId].points.push(point);
      drawFrame();
    };

    // Other user finished drawing — clear live preview (full path arrives via map-drawing-update)
    const onDrawingFinalize = ({ pathId }) => { delete livePathsRef.current[pathId]; drawFrame(); };

    const onDrawingUpdate = ({ mapId, path }) => {
      if (mapId !== activeMapRef.current?.id) return;
      delete livePathsRef.current[path.id]; // clear live version
      setPaths(prev => [...prev, path]);
    };
    const onDrawingsErased = ({ mapId, erasedIds }) => {
      if (mapId !== activeMapRef.current?.id) return;
      setPaths(prev => prev.filter(p => !erasedIds.includes(p.id)));
    };
    const onDrawingsCleared = ({ mapId }) => {
      if (mapId !== activeMapRef.current?.id) return;
      pathsRef.current = []; setPaths([]);
    };
    const onMapChanged = ({ map }) => {
      if (!map) return;
      setMaps(prev => prev.map(m => ({ ...m, is_active: m.id === map.id ? 1 : 0 })));
        setActiveMap(map); loadFog(map); loadImgTransform(map);
    };
    const onFogUpdate = ({ mapId, fogCells: cells, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const s = new Set(Array.isArray(cells) ? cells : []);
      fogCellsRef.current = s; setFogCells(s);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
    };
    // Live fog preview while DM is painting (no DB write — same as map-drawing-live)
    const onFogLive = ({ mapId, fogCells: cells, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const s = new Set(Array.isArray(cells) ? cells : []);
      fogCellsRef.current = s; setFogCells(s);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
    };
    // Feature 2 — mise à jour image live (pendant drag MJ) ou finale (mouseUp)
    const onImageUpdated = ({ mapId, img_x, img_y, img_scale, live }) => {
      if (mapId !== activeMapRef.current?.id) return;
      // Mise à jour immédiate des refs → drawFrame sans attendre React
      imgXRef.current = img_x; imgYRef.current = img_y; imgScaleRef.current = img_scale;
      drawFrame();
      // Synchro React state seulement pour la position finale (évite les re-renders pendant le drag)
      if (!live) { setImgX(img_x); setImgY(img_y); setImgScale(img_scale); }
    };
    // Feature 5 — renommage de map en temps réel
    const onMapRenamed = ({ mapId, name }) => {
      setMaps(prev => prev.map(m => m.id === mapId ? { ...m, name } : m));
      setActiveMap(prev => (prev?.id === mapId ? { ...prev, name } : prev));
    };
    const onMapDeleted = ({ mapId }) => {
      setMaps(prev => { const next = prev.filter(m => m.id !== mapId); if (activeMapRef.current?.id === mapId) setActiveMap(next[0] || null); return next; });
    };
    const onMapListUpdated = () => { fetchMapsRef.current?.(); };
    const onCursorUpdate = ({ userId, username, x, y, isDM: cursorIsDM }) => {
      const vis = cursorVisualsRef.current[userId] || { x, y };
      cursorLerpsRef.current[userId] = { fromX: vis.x, fromY: vis.y, toX: x, toY: y, startTime: Date.now(), duration: 100 };
      // Stocker isDM pour que drawFrame puisse filtrer le curseur du MJ côté joueurs
      otherCursorsRef.current = { ...otherCursorsRef.current, [userId]: { userId, username, x, y, isDM: cursorIsDM } };
      startLerpAnimation();
    };
    // Mise à jour du label du curseur si l'utilisateur est présent sur la carte
    const onUsernameUpdated = ({ userId, newUsername }) => {
      if (otherCursorsRef.current[userId]) {
        otherCursorsRef.current = {
          ...otherCursorsRef.current,
          [userId]: { ...otherCursorsRef.current[userId], username: newUsername },
        };
      }
    };
    const onPing = ({ x, y }) => {
      pingAnimRef.current = [...pingAnimRef.current, { x, y, ts: Date.now() }];
      drawFrame();
    };
    // Forme ajoutée par un autre joueur — mise à jour locale
    const onShapeAdded = ({ mapId, shape }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const next = [...shapesRef.current, shape];
      shapesRef.current = next; setShapes(next); drawFrame();
    };
    // Forme supprimée par un autre joueur — mise à jour locale
    const onShapeDeleted = ({ mapId, shapeId }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const next = shapesRef.current.filter(s => s.id !== shapeId);
      shapesRef.current = next; setShapes(next);
      if (selectedShapeRef.current?.id === shapeId) { selectedShapeRef.current = null; setSelectedShape(null); }
      drawFrame();
    };
    const onGridSize = ({ mapId, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      gridSizeRef.current = gs; setGridSize(gs);
    };
    const onMapImageCleared = ({ mapId }) => {
      if (mapId !== activeMapRef.current?.id) return;
      mapImageRef.current = null; setMapImage(null); drawFrame();
    };
    // Réception des cellules révélées depuis un autre joueur (pendant son drag)
    const onFogExplored = ({ removedCells }) => {
      if (Array.isArray(removedCells)) {
        removedCells.forEach(c => fogCellsRef.current.delete(c));
        setFogCells(new Set(fogCellsRef.current));
      }
      drawFrame();
    };

    socket.on('map-token-update', onTokenUpdate);
    socket.on('map-list-updated', onMapListUpdated);
    socket.on('map-drawing-live', onLiveDrawing);
    socket.on('map-drawing-finalize', onDrawingFinalize);
    socket.on('map-drawing-update', onDrawingUpdate);
    socket.on('map-drawings-erased', onDrawingsErased);
    socket.on('map-drawings-cleared', onDrawingsCleared);
    socket.on('map-changed', onMapChanged);
    socket.on('map-fog-update', onFogUpdate);
    socket.on('map-fog-live', onFogLive);
    socket.on('map-image-updated', onImageUpdated);
    socket.on('map-deleted', onMapDeleted);
    socket.on('map-renamed', onMapRenamed);
    socket.on('cursor-update', onCursorUpdate);
    socket.on('username-updated', onUsernameUpdated);
    socket.on('map-ping', onPing);
    socket.on('map-grid-size', onGridSize);
    socket.on('map-image-cleared', onMapImageCleared);
    socket.on('map-fog-explored', onFogExplored);
    socket.on('map-shape-added', onShapeAdded);
    socket.on('map-shape-deleted', onShapeDeleted);
    return () => {
      socket.off('connect', onConnect);
      socket.off('map-token-update', onTokenUpdate);
      socket.off('map-list-updated', onMapListUpdated);
      socket.off('map-drawing-live', onLiveDrawing);
      socket.off('map-drawing-finalize', onDrawingFinalize);
      socket.off('map-drawing-update', onDrawingUpdate);
      socket.off('map-drawings-erased', onDrawingsErased);
      socket.off('map-drawings-cleared', onDrawingsCleared);
      socket.off('map-changed', onMapChanged);
      socket.off('map-fog-update', onFogUpdate);
      socket.off('map-fog-live', onFogLive);
      socket.off('map-image-updated', onImageUpdated);
      socket.off('map-deleted', onMapDeleted);
      socket.off('map-renamed', onMapRenamed);
      socket.off('cursor-update', onCursorUpdate);
      socket.off('username-updated', onUsernameUpdated);
      socket.off('map-ping', onPing);
      socket.off('map-grid-size', onGridSize);
      socket.off('map-image-cleared', onMapImageCleared);
      socket.off('map-fog-explored', onFogExplored);
      socket.off('map-shape-added', onShapeAdded);
      socket.off('map-shape-deleted', onShapeDeleted);
      socket.off('map-sync', onMapSync);
    };
  }, [socket, startLerpAnimation, drawFrame]);

  // Load map when active changes — guard against spurious re-runs (ex: rename)
  useEffect(() => {
    if (!activeMap) {
      prevMapIdRef.current = null;
      mapImageRef.current = null; setMapImage(null);
      tokensRef.current = []; setTokens([]);
      pathsRef.current = []; setPaths([]);
      shapesRef.current = []; setShapes([]);
      fogCellsRef.current = new Set(); setFogCells(new Set());
      livePathsRef.current = {};
      drawFrame();
      return;
    }
    if (prevMapIdRef.current === activeMap.id) return; // même map (rename, etc.) — ne pas recharger
    prevMapIdRef.current = activeMap.id;

    // Charger l'image via Image() pour rendre mapImageRef disponible rapidement (hit-test map-edit)
    // Le <img> HTML React gère l'affichage visuel (animation GIF native)
    if (activeMap.image_path) {
      const io = new Image();
      io.src = `${import.meta.env.VITE_API_URL}${activeMap.image_path}`;
      io.onload = () => { if (prevMapIdRef.current === activeMap.id) { mapImageRef.current = io; setMapImage(io); } };
      io.onerror = () => { mapImageRef.current = null; setMapImage(null); };
    } else {
      mapImageRef.current = null; setMapImage(null);
    }

    const toks = typeof activeMap.tokens === 'string' ? JSON.parse(activeMap.tokens) : (activeMap.tokens || []);
    tokensRef.current = toks; setTokens(toks);
    const pths = typeof activeMap.drawings === 'string' ? JSON.parse(activeMap.drawings) : (activeMap.drawings || []);
    pathsRef.current = pths; setPaths(pths);
    const shps = typeof activeMap.shapes === 'string' ? JSON.parse(activeMap.shapes) : (activeMap.shapes || []);
    shapesRef.current = shps; setShapes(shps);
    livePathsRef.current = {};
    loadFog(activeMap); loadImgTransform(activeMap);
  }, [activeMap, drawFrame]);

  const loadFog = (map) => {
    try {
      const raw = JSON.parse(map.fog_data || '[]');
      // Format ancien : tableau simple. Format nouveau : {cells, gs}
      const cells = Array.isArray(raw) ? raw : (raw.cells || []);
      const gs    = Array.isArray(raw) ? null : raw.gs;
      const s = new Set(cells);
      fogCellsRef.current = s; setFogCells(s);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
    } catch { fogCellsRef.current = new Set(); setFogCells(new Set()); }
  };
  const loadImgTransform = (map) => {
    const x = map.img_x || 0, y = map.img_y || 0, s = map.img_scale || 1;
    setImgX(x); setImgY(y); setImgScale(s);
  };

  const fetchMaps = useCallback(async () => {
    const res = await fetch(`${API}/maps/session/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json(); setMaps(data);
      if (!activeMapRef.current || !data.find(m => m.id === activeMapRef.current.id)) {
        const a = data.find(m => m.is_active) || data[0];
        setActiveMap(a || null); // null clears map when all maps deleted
      }
    }
  }, [sessionId, token]);
  fetchMapsRef.current = fetchMaps; // keep ref fresh without adding to socket effect deps
  useEffect(() => { fetchMaps(); }, [fetchMaps]);

  const uploadMap = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('image', f); fd.append('session_id', sessionId); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
    const res = await fetch(`${API}/maps`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    if (res.ok) {
      const newMap = await res.json();
      fetchMaps(); // rafraîchir la liste locale
      if (socket) {
        // Notifier les autres que la liste a changé
        socket.emit('map-uploaded', { sessionId });
        // Basculer immédiatement vers la nouvelle map pour tout le monde (MJ + joueurs)
        socket.emit('map-change', { sessionId, mapId: newMap.id, currentMapId: activeMapRef.current?.id, tokens: tokensRef.current });
      }
    }
    e.target.value = '';
  };
  const deleteCurrentMap = () => {
    if (!activeMapRef.current) return;
    setShowDeleteConfirm(true);
  };
  const confirmDeleteMap = async () => {
    setShowDeleteConfirm(false);
    const mapId = activeMapRef.current?.id;
    if (!mapId) return;
    const res = await fetch(`${API}/maps/${mapId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      if (socket) socket.emit('map-delete', { sessionId, mapId });
      fetchMaps();
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const getWorldPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const pan = panOffsetRef.current, z = zoomRef.current;
    return { x: (e.clientX - rect.left - pan.x) / z, y: (e.clientY - rect.top - pan.y) / z };
  };
  const snapPos = (x, y) => ({ x, y });
  const paintFog = (wx, wy, adding) => {
    const half = fogBrushPxRef.current / 2, gs = gridSizeRef.current;
    if (gs <= 0) return;
    const cx0 = Math.floor((wx - half) / gs), cy0 = Math.floor((wy - half) / gs);
    const cx1 = Math.floor((wx + half) / gs), cy1 = Math.floor((wy + half) / gs);
    const next = new Set(fogCellsRef.current);
    // Bounds de l'image — le fog ne peut être ajouté qu'à l'intérieur de la map
    const img = mapImageRef.current;
    const imgLeft   = img ? imgXRef.current : -Infinity;
    const imgRight  = img ? imgXRef.current + img.naturalWidth  * imgScaleRef.current : Infinity;
    const imgTop    = img ? imgYRef.current : -Infinity;
    const imgBottom = img ? imgYRef.current + img.naturalHeight * imgScaleRef.current : Infinity;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        if (adding) {
          // Vérifier que le centre de la cellule est dans les bounds de l'image avant d'ajouter
          const centerX = cx * gs + gs / 2;
          const centerY = cy * gs + gs / 2;
          if (centerX >= imgLeft && centerX <= imgRight && centerY >= imgTop && centerY <= imgBottom)
            next.add(`${cx},${cy}`);
        } else {
          next.delete(`${cx},${cy}`);
        }
      }
    }
    fogCellsRef.current = next; setFogCells(next); drawFrame();
  };
  const getMapImgHit = (pos) => {
    const img = mapImageRef.current; if (!img) return null;
    const ix = imgXRef.current, iy = imgYRef.current;
    const iw = img.naturalWidth * imgScaleRef.current, ih = img.naturalHeight * imgScaleRef.current;
    const hs = 14 / zoomRef.current;
    for (const [type, hx, hy] of [['nw', ix, iy], ['ne', ix + iw, iy], ['se', ix + iw, iy + ih], ['sw', ix, iy + ih]]) {
      const dx = pos.x - hx, dy = pos.y - hy; if (dx * dx + dy * dy < hs * hs) return type;
    }
    if (pos.x >= ix && pos.x <= ix + iw && pos.y >= iy && pos.y <= iy + ih) return 'move';
    return null;
  };
  const emitImgTransform = (x, y, s) => {
    if (!socket || !activeMapRef.current) return;
    socket.emit('map-image-transform', { sessionId, mapId: activeMapRef.current.id, img_x: Math.round(x), img_y: Math.round(y), img_scale: s });
  };

  // ─── Mouse handlers ───────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    if (e.button === 2) {
      const pos = getWorldPos(e);
      if (socket) socket.emit('map-ping', { sessionId, x: pos.x, y: pos.y });
      e.preventDefault(); return;
    }
    const pos = getWorldPos(e);

    if (toolRef.current === 'map-edit' && isDM) {
      const hit = getMapImgHit(pos);
      if (hit) {
        const img = mapImageRef.current;
        const iw = img ? img.naturalWidth * imgScaleRef.current : 0, ih = img ? img.naturalHeight * imgScaleRef.current : 0;
        setEditingMapImg({ type: hit, startPos: pos, startX: imgXRef.current, startY: imgYRef.current, startW: iw, startH: ih, startScale: imgScaleRef.current, origW: img?.naturalWidth || 1 });
        return;
      }
    }
    if ((toolRef.current === 'fog-add' || toolRef.current === 'fog-erase') && isDM) { saveUndoState(); fogPainting.current = true; paintFog(pos.x, pos.y, toolRef.current === 'fog-add'); return; }
    if (toolRef.current === 'erase' && isDM) {
      eraserActive.current = true;
      saveUndoState();
      const r = eraserSize / zoomRef.current;
      const ids = pathsRef.current.filter(p => p.points?.some(pt => { const dx = pt.x - pos.x, dy = pt.y - pos.y; return dx * dx + dy * dy < r * r; })).map(p => p.id);
      if (ids.length) {
        const next = pathsRef.current.filter(p => !ids.includes(p.id));
        pathsRef.current = next; setPaths(next); drawFrame();
        if (socket) socket.emit('map-drawing-erase', { sessionId, mapId: activeMapRef.current?.id, erasedIds: ids });
      }
      return;
    }
    if (toolRef.current === 'draw') {
      currentPathIdRef.current = `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      currentPathRef.current = [pos];
      isDrawingRef.current = true;
      setDrawing(true); return;
    }
    // Démarrer le dessin d'une forme de sort
    if (toolRef.current === 'shape') {
      isDrawingShapeRef.current = true;
      currentShapeRef.current = {
        id: crypto.randomUUID(),
        type: shapeTypeRef.current,
        x: pos.x, y: pos.y, x2: pos.x, y2: pos.y,
        color: shapeColorRef.current,
        width: shapeWidthRef.current,
        filled: shapeFilledRef.current,
        opacity: shapeOpacityRef.current,
        createdBy: user?.id,
      };
      return;
    }
    if (toolRef.current === 'token' && newTokenName.trim()) {
      saveUndoState();
      const sp = snapPos(pos.x, pos.y);
      // Fix 4 : visionRadius = 'normal' par défaut — le MJ peut le changer ensuite
      const tok = { id: `tok_${Date.now()}_${Math.random().toString(36).slice(2)}`, name: newTokenName, color: newTokenColor, borderColor: newTokenBorderColor, radius: clamp(newTokenRadius, 10, 120), image: newTokenImage, x: sp.x, y: sp.y, hidden: newTokenHidden, visionRadius: 'normal', nightVision: false, createdBy: user.id, createdByName: user.username };
      const upd = [...tokensRef.current, tok]; tokensRef.current = upd; setTokens(upd); drawFrame();
      if (socket) socket.emit('map-token-add', { sessionId, mapId: activeMapRef.current?.id, token: tok, allTokens: upd });
      return;
    }
    if (toolRef.current === 'move') {
      const sel = selectedTokenRef.current;
      if (sel) {
        const r = clamp(sel.radius || 22, 10, 120);
        const hx = sel.x + r * 0.707, hy = sel.y + r * 0.707;
        const dx = pos.x - hx, dy = pos.y - hy;
        const canManageSel = isDM || !sel.createdBy || sel.createdBy === user?.id;
        if (!sel.locked && canManageSel && dx * dx + dy * dy <= (12 / zoomRef.current) ** 2) { resizingToken.current = { token: sel }; return; }
      }
      const clicked = tokensRef.current.find(t => { const r = clamp(t.radius || 22, 10, 120); const dx = t.x - pos.x, dy = t.y - pos.y; return dx * dx + dy * dy <= (r + 5) ** 2; });
      if (clicked) {
        if (selectedTokenRef.current?.id !== clicked.id) setShowTokenEdit(false);
        dragMoved.current = false;
        selectedTokenRef.current = clicked; setSelectedToken(clicked);
        // Feature 1 — amener le token au premier plan (dernier dans le tableau = dessiné par-dessus)
        if (clicked.id !== tokensRef.current[tokensRef.current.length - 1]?.id) {
          const reordered = [...tokensRef.current.filter(t => t.id !== clicked.id), clicked];
          tokensRef.current = reordered; setTokens(reordered);
          if (socket && activeMapRef.current) {
            socket.emit('map-token-reorder', { sessionId, mapId: activeMapRef.current.id, tokens: reordered });
          }
        }
        const canManage = isDM || !clicked.createdBy || clicked.createdBy === user?.id;
        if (canManage) { saveUndoState(); isDraggingRef.current = clicked; setDragging(clicked); }
        return;
      }
      // Vérifier si une forme de sort est cliquée avant de panner
      const clickedShape = shapesRef.current.find(s => hitTestShape(s, pos, 12 / zoomRef.current));
      if (clickedShape) {
        selectedShapeRef.current = clickedShape; setSelectedShape(clickedShape);
        selectedTokenRef.current = null; setSelectedToken(null); setShowTokenEdit(false);
        drawFrame(); return;
      }
      selectedShapeRef.current = null; setSelectedShape(null);
      setSelectedToken(null); selectedTokenRef.current = null; setShowTokenEdit(false);
      isPanningRef.current = true; setIsPanning(true);
      panStartRef.current = { x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y };
    }
  };

  const handleMouseMove = (e) => {
    const pos = getWorldPos(e);
    mouseWorldPosRef.current = pos;
    const now = Date.now();

    // Broadcast cursor position (throttled 100ms)
    if (socket && now - lastCursorEmit.current > 100) {
      lastCursorEmit.current = now;
      socket.emit('cursor-move', { sessionId, x: pos.x, y: pos.y });
    }

    if (editingMapImg) {
      const { type, startPos, startX, startY, startW, startH, origW } = editingMapImg;
      const dx = pos.x - startPos.x, dy = pos.y - startPos.y;
      if (type === 'move') { imgXRef.current = startX + dx; imgYRef.current = startY + dy; }
      else {
        let nw = startW, nx = startX, ny = startY;
        if (type === 'se') nw = Math.max(50, startW + dx);
        else if (type === 'sw') { nw = Math.max(50, startW - dx); nx = startX + (startW - nw); }
        else if (type === 'ne') { nw = Math.max(50, startW + dx); }
        else if (type === 'nw') { nw = Math.max(50, startW - dx); nx = startX + (startW - nw); }
        const ns = nw / origW;
        const nh = (mapImageRef.current?.naturalHeight || 1) * ns;
        if (type === 'ne' || type === 'nw') ny = startY + startH - nh;
        imgScaleRef.current = ns; imgXRef.current = nx; imgYRef.current = ny;
      }
      drawFrame();
      // Feature 2 — diffuser la transformation en temps réel aux joueurs (throttled ~60fps)
      if (socket && activeMapRef.current && now - lastImgTransformEmit.current > 16) {
        lastImgTransformEmit.current = now;
        socket.emit('map-image-transform', {
          sessionId, mapId: activeMapRef.current.id,
          img_x: Math.round(imgXRef.current), img_y: Math.round(imgYRef.current),
          img_scale: imgScaleRef.current, live: true
        });
      }
      return; // setState deferred to mouseUp → no re-renders during drag
    }
    if (fogPainting.current && isDM) {
      paintFog(pos.x, pos.y, toolRef.current === 'fog-add');
      if (socket && now - lastFogEmit.current > 100) {
        lastFogEmit.current = now;
        socket.emit('map-fog-live', { sessionId, mapId: activeMapRef.current?.id, fogCells: Array.from(fogCellsRef.current), gridSize: gridSizeRef.current });
      }
      return;
    }
    if (eraserActive.current && isDM) {
      const r = eraserSize / zoomRef.current;
      const ids = pathsRef.current.filter(p => p.points?.some(pt => { const dx = pt.x - pos.x, dy = pt.y - pos.y; return dx * dx + dy * dy < r * r; })).map(p => p.id);
      if (ids.length) {
        const next = pathsRef.current.filter(p => !ids.includes(p.id));
        pathsRef.current = next; setPaths(next); drawFrame();
        if (socket) socket.emit('map-drawing-erase', { sessionId, mapId: activeMapRef.current?.id, erasedIds: ids });
      }
      return;
    }
    if (resizingToken.current) {
      const t = resizingToken.current.token;
      const newR = clamp(Math.round(Math.sqrt((pos.x - t.x) ** 2 + (pos.y - t.y) ** 2)), 10, 120);
      const upd = tokensRef.current.map(tk => tk.id === t.id ? { ...tk, radius: newR } : tk);
      tokensRef.current = upd; setTokens(upd);
      const updSel = { ...(selectedTokenRef.current || t), radius: newR }; selectedTokenRef.current = updSel; setSelectedToken(updSel);
      drawFrame();
      if (socket && now - lastDragEmit.current > 16) { lastDragEmit.current = now; socket.emit('map-token-move', { sessionId, mapId: activeMapRef.current?.id, tokenId: t.id, radius: newR, live: true }); }
      return;
    }
    // Prévisualisation live de la forme en cours de dessin
    if (isDrawingShapeRef.current && currentShapeRef.current) {
      currentShapeRef.current = { ...currentShapeRef.current, x2: pos.x, y2: pos.y };
      drawFrame(); return;
    }
    if (isDrawingRef.current) {
      currentPathRef.current = [...currentPathRef.current, pos];
      drawFrame();
      // ← Live drawing emit at ~60fps — each new point sent immediately
      if (socket && now - lastDrawEmit.current > 16) {
        lastDrawEmit.current = now;
        socket.emit('map-drawing-live', { sessionId, mapId: activeMapRef.current?.id, pathId: currentPathIdRef.current, point: pos, color: drawColorRef.current, width: drawWidthRef.current });
      }
      return;
    }
    if (isPanningRef.current) { const np = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y }; panOffsetRef.current = np; drawFrame(); return; }
    if (isDraggingRef.current && !isDraggingRef.current.locked) {
      dragMoved.current = true;
      const sp = snapPos(pos.x, pos.y);
      const upd = tokensRef.current.map(t => t.id === isDraggingRef.current.id ? { ...t, ...sp } : t);
      tokensRef.current = upd; // no setTokens during drag — avoids React re-renders at 60fps
      tokenVisualsRef.current[isDraggingRef.current.id] = sp; // sync visual so drawFrame shows local movement
      if (selectedTokenRef.current?.id === isDraggingRef.current.id) { const mv = upd.find(t => t.id === isDraggingRef.current.id); selectedTokenRef.current = mv; } // no setSelectedToken in hot path
      // Sync le div overlay impérativement (pas de re-render React pendant le drag)
      const dragEl = tokenDivsRef.current[isDraggingRef.current.id];
      if (dragEl) { const dr = clamp(isDraggingRef.current.radius || 22, 10, 120); dragEl.style.left = `${sp.x - dr}px`; dragEl.style.top = `${sp.y - dr}px`; }
      drawFrame();
      // ← Token drag emit at ~60fps (live=true → no DB write, triggers lerp on receivers)
      if (socket && now - lastDragEmit.current > 16) {
        lastDragEmit.current = now;
        socket.emit('map-token-move', { sessionId, mapId: activeMapRef.current?.id, tokenId: isDraggingRef.current.id, x: sp.x, y: sp.y, live: true });
      }
      // Révélation du fog MJ — toutes les 50ms pendant le drag pour une fluidité maximale
      if (gridSizeRef.current > 0 && now - lastFogUpdateRef.current > 50) {
        lastFogUpdateRef.current = now;
        const currentTok = tokensRef.current.find(t => t.id === isDraggingRef.current.id);
        if (currentTok && !currentTok.hidden && currentTok.type !== 'enemy') {
          const removed = revealFogForToken(currentTok);
          if (removed.length > 0) {
            setFogCells(new Set(fogCellsRef.current)); // sync React state pour le token overlay
            drawFrame(); // redessiner pour afficher le fog révélé en temps réel
            if (socket) {
              socket.emit('map-fog-explored', { sessionId, removedCells: removed });
            }
          }
        }
      }
    }
  };

  const handleMouseUp = () => {
    // Capture what was active before clearing refs
    const wasPanning = isPanningRef.current;
    isDrawingRef.current = false;
    isPanningRef.current = false;
    const wasDragging = isDraggingRef.current;
    isDraggingRef.current = null;
    // Finalisation de la forme de sort
    const wasDrawingShape = isDrawingShapeRef.current;
    isDrawingShapeRef.current = false;
    if (wasDrawingShape && currentShapeRef.current) {
      const shape = currentShapeRef.current;
      const sizeSq = (shape.x2 - shape.x) ** 2 + (shape.y2 - shape.y) ** 2;
      if (sizeSq > 25) { // ignorer les formes trop petites (clic accidentel)
        const next = [...shapesRef.current, shape];
        shapesRef.current = next; setShapes(next);
        if (socket && activeMapRef.current)
          socket.emit('map-shape-add', { sessionId, mapId: activeMapRef.current.id, shape });
      }
      currentShapeRef.current = null; drawFrame(); return;
    }

    if (editingMapImg) {
      // Sync React state from refs (deferred from mousemove for performance)
      setImgX(imgXRef.current); setImgY(imgYRef.current); setImgScale(imgScaleRef.current);
      emitImgTransform(imgXRef.current, imgYRef.current, imgScaleRef.current); setEditingMapImg(null); return;
    }
    if (fogPainting.current) {
      fogPainting.current = false;
      if (socket && activeMapRef.current) socket.emit('map-fog-paint', { sessionId, mapId: activeMapRef.current.id, fogCells: Array.from(fogCellsRef.current), gridSize: gridSizeRef.current });
    }
    eraserActive.current = false;
    if (resizingToken.current) {
      if (socket) {
        const resizeTok = tokensRef.current.find(tk => tk.id === resizingToken.current.token.id);
        if (resizeTok) socket.emit('map-token-move', { sessionId, mapId: activeMapRef.current?.id, tokenId: resizeTok.id, radius: resizeTok.radius, live: false });
      }
      resizingToken.current = null;
    }
    if (drawing && currentPathRef.current.length > 1) {
      saveUndoState();
      // Use the SAME id that was used for live segments → receivers clear the live preview
      const newPath = { id: currentPathIdRef.current, color: drawColorRef.current, width: drawWidthRef.current, points: currentPathRef.current };
      const next = [...pathsRef.current, newPath]; pathsRef.current = next; setPaths(next);
      currentPathRef.current = [];
      if (socket) {
        socket.emit('map-drawing', { sessionId, mapId: activeMapRef.current?.id, path: newPath });
        socket.emit('map-drawing-finalize', { sessionId, pathId: newPath.id });
      }
    }
    if (wasDragging && dragMoved.current && socket) {
      const mv = tokensRef.current.find(t => t.id === wasDragging.id);
      if (mv) { selectedTokenRef.current = mv; setSelectedToken(mv); }
      setTokens([...tokensRef.current]); // sync React state once after drag (not per-frame)
      if (mv) socket.emit('map-token-move', { sessionId, mapId: activeMapRef.current?.id, tokenId: wasDragging.id, x: mv.x, y: mv.y, live: false });
      // Persister le fog en DB après le déplacement (map-fog-paint = sauvegarde définitive)
      if (activeMapRef.current && !wasDragging.hidden && wasDragging.type !== 'enemy') {
        socket.emit('map-fog-paint', {
          sessionId,
          mapId: activeMapRef.current.id,
          fogCells: [...fogCellsRef.current],
          gridSize: gridSizeRef.current,
        });
      }
    }
    // Single click (no drag) → detect double-click to open edit panel
    if (wasDragging && !dragMoved.current) {
      const now = Date.now();
      const last = tokenLastClickRef.current;
      if (last.id === wasDragging.id && (now - last.time) < 350) {
        // Calculer la position initiale du panneau d'édition près du token (Fix 4)
        const tok = tokensRef.current.find(t => t.id === wasDragging.id);
        if (tok) {
          const z = zoomRef.current;
          const pan = panOffsetRef.current;
          const r = clamp(tok.radius || 22, 10, 120);
          const panelW = 248;
          const contW = containerRef.current?.clientWidth || 600;
          const contH = containerRef.current?.clientHeight || 400;
          const tokSx = tok.x * z + pan.x;
          const tokSy = tok.y * z + pan.y;
          const sx = (tokSx + r + 12 + panelW < contW) ? tokSx + r + 12 : Math.max(8, tokSx - r - panelW - 12);
          const sy = Math.max(8, Math.min(contH - 280, tokSy - r));
          setTokenEditPos({ x: Math.max(8, sx), y: sy });
        }
        setShowTokenEdit(true);
      }
      tokenLastClickRef.current = { id: wasDragging.id, time: now };
    }
    if (wasPanning) setPanOffset({ ...panOffsetRef.current }); // sync state once after pan (deferred from mousemove)
    setDrawing(false); setIsPanning(false); setDragging(null); drawFrame();
  };

  // Wheel zoom — must be non-passive to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const nz = clamp(zoomRef.current + (e.deltaY > 0 ? -0.1 : 0.1), 0.2, 4);
      zoomRef.current = nz; setZoom(nz); drawFrame();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [drawFrame]);

  const updateToken = (upd) => {
    const next = tokensRef.current.map(t => t.id === upd.id ? upd : t);
    tokensRef.current = next; setTokens(next); selectedTokenRef.current = upd; setSelectedToken(upd); drawFrame();
    if (socket) socket.emit('map-token-move', { sessionId, mapId: activeMapRef.current?.id, tokens: next, live: false });
  };
  const deleteToken = (id) => {
    saveUndoState();
    const next = tokensRef.current.filter(t => t.id !== id);
    tokensRef.current = next; setTokens(next); selectedTokenRef.current = null; setSelectedToken(null); setShowTokenEdit(false); drawFrame();
    if (socket) socket.emit('map-token-delete', { sessionId, mapId: activeMapRef.current?.id, tokenId: id });
  };
  const confirmPendingDelete = () => {
    const p = pendingDelete; setPendingDelete(null);
    if (!p) return;
    if (p.type === 'token') { deleteToken(p.id); }
    else if (p.type === 'map-image') {
      mapImageRef.current = null; setMapImage(null); drawFrame();
      if (socket && activeMapRef.current) socket.emit('map-image-clear', { sessionId, mapId: activeMapRef.current.id });
    }
  };
  const clearFog = () => {
    const e = new Set(); fogCellsRef.current = e; setFogCells(e); drawFrame();
    if (socket && activeMapRef.current) socket.emit('map-fog-paint', { sessionId, mapId: activeMapRef.current.id, fogCells: [], gridSize: gridSizeRef.current });
  };
  const switchMap = (sel) => {
    if (!isDM || sel.id === activeMapRef.current?.id) return;
    setActiveMap(sel);
    if (socket) socket.emit('map-change', { sessionId, mapId: sel.id, currentMapId: activeMapRef.current?.id, tokens: tokensRef.current });
  };
  const resetImgTransform = () => { setImgX(0); setImgY(0); setImgScale(1); drawFrame(); emitImgTransform(0, 0, 1); };

  // Basculer une condition sur un token — accessible à tous (MJ et joueurs)
  const toggleCondition = (tokenId, conditionId) => {
    const tok = tokensRef.current.find(t => t.id === tokenId);
    if (!tok) return;
    const conditions = tok.conditions || [];
    const next = conditions.includes(conditionId)
      ? conditions.filter(c => c !== conditionId)
      : [...conditions, conditionId];
    updateToken({ ...tok, conditions: next });
  };

  // Feature 5 — valider le renommage de la map active
  const saveMapName = () => {
    if (editingMapName === null) return;
    const name = editingMapName.trim();
    if (name && name !== activeMap?.name) {
      // Émettre via socket → le serveur persiste et broadcaste map-renamed à tous
      if (socket) socket.emit('map-rename', { sessionId, mapId: activeMap.id, name });
      // Mise à jour locale immédiate pour éviter le flash
      setMaps(prev => prev.map(m => m.id === activeMap.id ? { ...m, name } : m));
      setActiveMap(prev => prev ? { ...prev, name } : prev);
    }
    setEditingMapName(null);
  };

  const getCursor = () => {
    if (tool === 'fog-add' || tool === 'fog-erase' || tool === 'erase') return 'cell';
    if (tool === 'draw' || tool === 'shape') return 'crosshair';
    if (tool === 'token') return 'copy';
    if (tool === 'map-edit') { if (!editingMapImg) return 'default'; if (editingMapImg.type === 'move') return 'grabbing'; return ['nw','se'].includes(editingMapImg.type) ? 'nwse-resize' : 'nesw-resize'; }
    if (resizingToken.current) return 'nwse-resize';
    if (dragging) return 'grabbing';
    return 'grab';
  };

  const dmTools = isDM ? [
    { id: 'draw', icon: '✏️', label: 'Dessiner' }, { id: 'erase', icon: '🧹', label: 'Gomme dessin' },
    { id: 'token', icon: '📍', label: 'Token' }, { id: 'map-edit', icon: '🖼️', label: 'Déplacer/redimensionner image' },
    { id: 'fog-add', icon: '🌫️', label: 'Brouillard +' }, { id: 'fog-erase', icon: '🌤️', label: 'Brouillard −' },
    { id: 'shape', icon: '🔮', label: 'Formes de sorts' },
  ] : [
    { id: 'token', icon: '📍', label: 'Token' },
    { id: 'shape', icon: '🔮', label: 'Formes de sorts' },
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '5px' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', padding: '5px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>

        <div style={{ display: 'flex', gap: '2px' }}>
          {[{ id: 'move', icon: '✋', label: 'Déplacer' }, ...dmTools].map(t => (
            <button key={t.id} className={`btn btn-sm ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTool(t.id)} title={t.label} style={{ fontSize: '0.9rem' }}>{t.icon}</button>
          ))}
        </div>

        {tool === 'draw' && isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input type="color" value={drawColor} onChange={e => setDrawColor(e.target.value)} style={{ width: '24px', height: '22px', padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="number" value={drawWidth} onChange={e => setDrawWidth(clamp(Number(e.target.value), 1, 20))} min={1} max={20} style={{ width: '44px', padding: '2px 4px', fontSize: '0.78rem' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>px</span>
            <button className="btn btn-sm btn-secondary" onClick={() => { pathsRef.current = []; setPaths([]); if (socket && activeMapRef.current) socket.emit('map-drawings-clear', { sessionId, mapId: activeMapRef.current.id }); }}>🗑️</button>
          </div>
        )}

        {tool === 'erase' && isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Gomme</span>
            <input type="number" value={eraserSize} onChange={e => setEraserSize(Math.max(5, Number(e.target.value)))} min={5} max={200} style={{ width: '52px', padding: '2px 4px', fontSize: '0.78rem' }} />
            <span style={{ color: 'var(--text-muted)' }}>px</span>
          </div>
        )}

        {tool === 'map-edit' && isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Glisser image • Coins = redimensionner</span>
            <button className="btn btn-sm btn-secondary" onClick={resetImgTransform}>↺ Reset</button>
          </div>
        )}

        {isDM && (tool === 'fog-add' || tool === 'fog-erase') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
            {/* Feature 3 — slider + champ numérique synchronisés pour le pinceau fog */}
            <input type="range" min={0} max={500} value={fogBrushPx} onChange={e => { const v = Number(e.target.value); setFogBrushPx(v); fogBrushPxRef.current = v; }} style={{ width: '70px', cursor: 'pointer' }} />
            <input type="number" value={fogBrushPx} onChange={e => { const v = clamp(Number(e.target.value), 0, 500); setFogBrushPx(v); fogBrushPxRef.current = v; }} min={0} max={500} style={{ width: '52px', padding: '2px 4px', fontSize: '0.78rem' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>px</span>
            <input type="color" value={fogColor} onChange={e => setFogColor(e.target.value)} style={{ width: '24px', height: '22px', padding: 0, border: 'none', cursor: 'pointer' }} />
            {fogCells.size > 0 && <button className="btn btn-sm btn-danger" onClick={clearFog}>🗑️{fogCells.size}</button>}
          </div>
        )}

        {/* Fog opacity — always visible for DM */}
        {isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Fog {Math.round(fogOpacity * 100)}%</span>
            <input type="range" min={0.1} max={1} step={0.05} value={fogOpacity}
              onChange={e => { const v = Number(e.target.value); fogOpacityRef.current = v; setFogOpacity(v); drawFrame(); }}
              style={{ width: '55px', cursor: 'pointer' }} />
          </div>
        )}
        {/* Sous-panneau formes de sorts — accessible à tous */}
        {tool === 'shape' && (
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { type: 'circle', icon: '⭕', label: 'Cercle' },
              { type: 'cone', icon: '📐', label: 'Cône' },
              { type: 'line', icon: '📏', label: 'Ligne' },
              { type: 'rectangle', icon: '⬜', label: 'Rectangle' },
            ].map(({ type, icon, label }) => (
              <button key={type}
                className={`btn btn-sm ${shapeType === type ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { setShapeType(type); shapeTypeRef.current = type; }}
                title={label} style={{ fontSize: '0.82rem' }}>
                {icon} {label}
              </button>
            ))}
            <input type="color" value={shapeColor}
              onChange={e => { setShapeColor(e.target.value); shapeColorRef.current = e.target.value; }}
              style={{ width: '24px', height: '22px', padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="range" min="1" max="10" value={shapeWidth}
              onChange={e => { const v = Number(e.target.value); setShapeWidth(v); shapeWidthRef.current = v; }}
              style={{ width: '60px', cursor: 'pointer' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{shapeWidth}px</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={shapeFilled}
                onChange={e => { setShapeFilled(e.target.checked); shapeFilledRef.current = e.target.checked; }}
                style={{ cursor: 'pointer' }} />
              Rempli
            </label>
            <input type="range" min="0.1" max="1" step="0.1" value={shapeOpacity}
              onChange={e => { const v = Number(e.target.value); setShapeOpacity(v); shapeOpacityRef.current = v; }}
              style={{ width: '60px', cursor: 'pointer' }} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{Math.round(shapeOpacity * 100)}%</span>
            {selectedShape && (
              <button className="btn btn-sm btn-danger" title="Supprimer la forme sélectionnée"
                onClick={() => {
                  const next = shapesRef.current.filter(s => s.id !== selectedShape.id);
                  shapesRef.current = next; setShapes(next);
                  selectedShapeRef.current = null; setSelectedShape(null); drawFrame();
                  if (socket && activeMapRef.current)
                    socket.emit('map-shape-delete', { sessionId, mapId: activeMapRef.current.id, shapeId: selectedShape.id });
                }}>🗑️ Forme</button>
            )}
          </div>
        )}

        {tool === 'token' && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" value={newTokenName} onChange={e => setNewTokenName(e.target.value)} placeholder="Nom" style={{ width: '90px', padding: '2px 5px', fontSize: '0.8rem' }} />
            <input type="color" value={newTokenColor} onChange={e => setNewTokenColor(e.target.value)} style={{ width: '24px', height: '22px', padding: 0, border: 'none', cursor: 'pointer' }} />
            <input type="color" value={newTokenBorderColor} onChange={e => setNewTokenBorderColor(e.target.value)} style={{ width: '24px', height: '22px', padding: 0, border: '2px solid rgba(255,255,255,0.3)', cursor: 'pointer' }} />
            <input type="number" value={newTokenRadius} onChange={e => setNewTokenRadius(Number(e.target.value))} min={10} max={150} title="Rayon px" style={{ width: '44px', padding: '2px 4px', fontSize: '0.78rem' }} />
            <button className="btn btn-sm btn-secondary" onClick={() => newTokenFileRef.current.click()}>{newTokenImage ? '🖼️✓' : '🖼️'}</button>
            <input ref={newTokenFileRef} type="file" accept="image/*,.jfif"
              onChange={async e => {
                const f = e.target.files[0]; if (!f) return;
                const fd = new FormData(); fd.append('image', f);
                const res = await fetch(`${API}/maps/token-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
                if (res.ok) { const d = await res.json(); setNewTokenImage(`${VITE_API}${d.path}`); }
                else { const e = await res.json().catch(() => ({})); alert(`Erreur upload image (${res.status}): ${e.error || 'inconnue'}`); }
              }} style={{ display: 'none' }} />
            {newTokenImage && <button className="btn btn-sm btn-secondary" onClick={() => setNewTokenImage(null)}>✕</button>}
            {isDM && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.75rem', color: newTokenHidden ? 'var(--accent-primary)' : 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }} title="Placer le token caché (invisible pour les joueurs)">
                <input type="checkbox" checked={newTokenHidden} onChange={e => setNewTokenHidden(e.target.checked)} style={{ cursor: 'pointer', accentColor: 'var(--accent-primary)' }} />
                🙈
              </label>
            )}
          </div>
        )}

        <div style={{ width: '1px', height: '20px', background: 'var(--border-color)', margin: '0 2px', flexShrink: 0 }} />

        {/* Toggle affichage de la grille */}
        <button className={`btn btn-sm ${showGrid ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { const v = !showGrid; showGridRef.current = v; setShowGrid(v); drawFrame(); }} title={showGrid ? 'Masquer la grille' : 'Afficher la grille'}>▦</button>

        {isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Grille</span>
            <input type="range" min={0} max={120} value={gridSize} onChange={e => {
              const gs = Number(e.target.value);
              gridSizeRef.current = gs; setGridSize(gs); drawFrame();
              if (socket && activeMapRef.current) socket.emit('map-grid-size', { sessionId, mapId: activeMapRef.current.id, gridSize: gs });
            }} style={{ width: '60px', cursor: 'pointer' }} />
            {/* Feature 3 — champ numérique synchronisé avec le slider grille */}
            <input type="number" value={gridSize} min={0} max={120} onChange={e => {
              const gs = clamp(Number(e.target.value), 0, 120);
              gridSizeRef.current = gs; setGridSize(gs); drawFrame();
              if (socket && activeMapRef.current) socket.emit('map-grid-size', { sessionId, mapId: activeMapRef.current.id, gridSize: gs });
            }} style={{ width: '46px', padding: '2px 4px', fontSize: '0.78rem' }} />
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>px</span>
          </div>
        )}

        <div style={{ width: '1px', height: '20px', background: 'var(--border-color)', margin: '0 2px', flexShrink: 0 }} />

        <button className={`btn btn-sm ${showCombat ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowCombat(v => !v)}>⚔️ Combat</button>
        <button className={`btn btn-sm ${showDice ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setShowDice(v => !v)}>🎲 Dés</button>

        {isDM && (
          <>
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              📤 Upload<input type="file" accept="image/*,.jfif,.jpe,.bmp,.tiff,.avif" onChange={uploadMap} style={{ display: 'none' }} />
            </label>
            {activeMap && <button className="btn btn-danger btn-sm" onClick={deleteCurrentMap} title="Supprimer cette map">🗑️</button>}
          </>
        )}

        {isDM && maps.length > 1 && (
          <select value={activeMap?.id || ''} onChange={e => { const s = maps.find(m => m.id === e.target.value); if (s) switchMap(s); }} style={{ padding: '2px 5px', fontSize: '0.78rem', maxWidth: '130px' }}>
            {maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        {/* Feature 5 — renommage de la map active — MJ uniquement (double-clic) */}
        {isDM && activeMap && (
          editingMapName !== null ? (
            <input
              type="text"
              value={editingMapName}
              onChange={e => setEditingMapName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveMapName(); if (e.key === 'Escape') setEditingMapName(null); }}
              onBlur={saveMapName}
              autoFocus
              style={{ width: '110px', fontSize: '0.78rem', padding: '2px 6px' }}
            />
          ) : (
            <button
              className="btn btn-sm btn-secondary"
              title="Double-clic pour renommer la map"
              onDoubleClick={() => setEditingMapName(activeMap.name || '')}
              style={{ fontSize: '0.72rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >✏️ {activeMap.name}</button>
          )
        )}

        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{Math.round(zoom * 100)}%</span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }} title="Clic droit = Ping">📌</span>
      </div>

      {/* Token / image-clear confirmation modal */}
      {pendingDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.55)' }} onClick={() => setPendingDelete(null)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-lg)', padding: '28px 32px', minWidth: '280px', boxShadow: '0 16px 48px rgba(0,0,0,0.8)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '2rem', marginBottom: '10px' }}>{pendingDelete.type === 'token' ? '🗑️' : '🖼️'}</div>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-danger)', marginBottom: '8px' }}>
              {pendingDelete.type === 'token' ? 'Supprimer le token' : 'Effacer l\'image'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>
              {pendingDelete.type === 'token'
                ? <>Supprimer <strong style={{ color: 'var(--text-primary)' }}>{pendingDelete.name || 'ce token'}</strong>&nbsp;?</>
                : 'Effacer l\'image de fond de la map définitivement ?'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setPendingDelete(null)}>Annuler</button>
              <button className="btn btn-danger" onClick={confirmPendingDelete}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete map confirmation modal */}
      {showDeleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)', background: 'rgba(0,0,0,0.55)' }} onClick={() => setShowDeleteConfirm(false)}>
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--accent-danger)', borderRadius: 'var(--radius-lg)', padding: '28px 32px', minWidth: '300px', boxShadow: '0 16px 48px rgba(0,0,0,0.8)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '2rem', marginBottom: '10px' }}>🗑️</div>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-danger)', marginBottom: '8px' }}>Supprimer la map</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '24px', fontSize: '0.9rem' }}>
              Supprimer <strong style={{ color: 'var(--text-primary)' }}>{activeMap?.name}</strong> définitivement&nbsp;?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Annuler</button>
              <button className="btn btn-danger" onClick={confirmDeleteMap}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, minHeight: '400px', position: 'relative', background: '#1c2033', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-color)', cursor: getCursor() }}>
        {/* Map world — <img> DOM visible pour animation GIF native, en dessous du canvas transparent */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div ref={mapWorldRef} style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0' }}>
            {activeMap?.image_path && (
              <img
                ref={mapImgElemRef}
                key={activeMap.id}
                src={`${import.meta.env.VITE_API_URL}${activeMap.image_path}`}
                style={{ position: 'absolute', display: 'block', objectFit: 'fill' }}
                draggable={false}
                alt=""
                onLoad={e => { if (!mapImageRef.current) { mapImageRef.current = e.currentTarget; setMapImage(e.currentTarget); } drawFrame(); }}
                onError={() => { mapImageRef.current = null; setMapImage(null); }}
              />
            )}
          </div>
        </div>
        {/* Canvas — position:absolute pour participer au stacking context et s'intercaler
            correctement entre la map HTML (avant dans le DOM) et les tokens (après).
            Sans position:absolute, le canvas est peint avant tous les éléments positionnés,
            y compris la map, ce qui fait passer les dessins derrière l'image. */}
        <canvas ref={canvasRef}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onContextMenu={e => e.preventDefault()}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
        />
        {/* Token overlay — après le canvas dans le DOM = au-dessus du canvas (z-index supérieur) */}
        {/* pointer-events:none → les clics passent à travers au canvas */}
        {/* Les tokens dans le brouillard ont opacity:0, cachés par le brouillard dessiné sur le canvas */}
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          <div ref={tokenWorldRef} style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0' }}>
            {tokens.filter(t => !t.hidden || isDM).map(t => {
              const r = clamp(t.radius || 22, 10, 120);
              const _ck = gridSize > 0 ? `${Math.floor(t.x / gridSize)},${Math.floor(t.y / gridSize)}` : '';
              // Token caché uniquement si la cellule est dans le fog MJ (peint manuellement)
              const inFog = !isDM && gridSize > 0 && fogCells.has(_ck);
              return (
                <div
                  key={t.id}
                  ref={el => { if (el) tokenDivsRef.current[t.id] = el; else delete tokenDivsRef.current[t.id]; }}
                  style={{
                    position: 'absolute',
                    left: t.x - r,
                    top: t.y - r,
                    width: r * 2,
                    height: r * 2,
                    borderRadius: '50%',
                    // Pas de overflow:hidden ici — le box-shadow doit déborder du cercle
                    opacity: inFog ? 0 : (t.hidden ? 0.5 : 1),
                    // Anneau de bordure + halo de sélection en CSS (toujours au-dessus du canvas)
                    boxShadow: t.id === selectedToken?.id
                      ? `0 0 0 2px #facc15, 0 0 0 8px rgba(250,204,21,0.35)`
                      : `0 0 0 2px ${t.borderColor || '#fff'}`,
                  }}
                >
                  {/* Div interne qui clippe l'image au cercle */}
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden' }}>
                    {t.image
                      ? <img src={t.image} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} alt="" />
                      : <div style={{ width: '100%', height: '100%', background: t.color || '#c9a84c' }} />
                    }
                  </div>
                  {/* Nom centré */}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#fff', fontSize: `${Math.max(7, Math.round(r * 0.38))}px`, fontWeight: 'bold', textShadow: '0 0 3px rgba(0,0,0,0.8)', textAlign: 'center', maxWidth: '90%', lineHeight: 1.1, wordBreak: 'break-word', userSelect: 'none' }}>{t.name}</span>
                  </div>
                  {t.locked && (
                    <span style={{ position: 'absolute', top: '6%', right: '6%', fontSize: `${Math.max(8, Math.round(r * 0.3))}px`, lineHeight: 1, userSelect: 'none' }}>🔒</span>
                  )}
                  {/* Handle de redimensionnement (coin bas-droite, hors du cercle) */}
                  {t.id === selectedToken?.id && !t.locked && (
                    <div style={{ position: 'absolute', left: r * 1.707 - 5, top: r * 1.707 - 5, width: 10, height: 10, borderRadius: '50%', background: '#facc15', border: '2px solid #000', zIndex: 1 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Canvas curseurs — positionné APRÈS l'overlay token dans le DOM = z-index supérieur aux tokens */}
        {/* pointerEvents:none → les clics continuent de passer au canvas principal */}
        <canvas
          ref={cursorCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
        {showDice && <FloatingPanel title="🎲 Dés" defaultPos={{ x: 16, y: 16 }} defaultSize={{ w: 300, h: 480 }} onClose={() => setShowDice(false)}><DiceRoller sessionId={sessionId} /></FloatingPanel>}
        {showCombat && <FloatingPanel title="⚔️ Combat" defaultPos={{ x: 16, y: showDice ? 450 : 16 }} defaultSize={{ w: 340, h: 540 }} onClose={() => setShowCombat(false)}><CombatTracker sessionId={sessionId} isDM={isDM} /></FloatingPanel>}
        {selectedToken && showTokenEdit && <TokenEditPanel token={selectedToken} isDM={isDM} onUpdate={updateToken} onDelete={() => setPendingDelete({ type: 'token', id: selectedToken.id, name: selectedToken.name })} onClose={() => { setSelectedToken(null); selectedTokenRef.current = null; setShowTokenEdit(false); drawFrame(); }} initialPos={tokenEditPos} onToggleCondition={toggleCondition} />}
      </div>
    </div>
  );
}
