import { useState, useRef } from 'react';
import { useDraggable } from '../../hooks/useDraggable';

// ─── Floating resizable panel ────────────────────────────────────────────────
export default function FloatingPanel({ title, defaultPos, defaultSize, onClose, children }) {
  const [pos, setPos] = useState(defaultPos || { x: 16, y: 16 });
  const [size, setSize] = useState(defaultSize || { w: 320, h: 480 });
  const ori = useRef({});

  // Ne pas démarrer le drag depuis un élément interactif (sélecteur par défaut du hook)
  const startDrag = useDraggable(pos, setPos, (rawX, rawY) => ({
    x: Math.max(0, Math.min(window.innerWidth - size.w, rawX)),
    y: Math.max(0, Math.min(window.innerHeight - 40, rawY)),
  }));

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
