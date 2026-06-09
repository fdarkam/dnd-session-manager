import { useState, useEffect, useRef, useCallback } from 'react';
import { useDraggable } from '../../hooks/useDraggable';
import { CONDITIONS } from '../../domain/conditions';

// ─── Fenêtre info token — lecture seule, draggable, fermeture auto 5 s ──────
function TokenInfoPanel({ info, onClose, containerRef }) {
  const [pos, setPos] = useState({ x: info.x, y: info.y });
  const timerRef = useRef(null);
  // Ref toujours fraîche vers onClose pour éviter les closures périmées dans le timer
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Lance (ou reporte) la fermeture automatique dans 5 secondes
  const scheduleClose = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCloseRef.current?.(), 5000);
  }, []);

  useEffect(() => {
    scheduleClose();
    return () => clearTimeout(timerRef.current);
  }, [scheduleClose]);

  // contW/contH lus à chaque mousemove via containerRef (dimensions live), comme avant.
  const startDrag = useDraggable(pos, setPos, (rawX, rawY) => {
    const contW = containerRef.current?.clientWidth || 600;
    const contH = containerRef.current?.clientHeight || 400;
    return {
      x: Math.max(0, Math.min(contW - 175, rawX)),
      y: Math.max(0, Math.min(contH - 40, rawY)),
    };
  }, { skip: 'button', onStart: scheduleClose });

  return (
    <div
      onMouseDown={startDrag}
      onMouseMove={scheduleClose}
      style={{
        position: 'absolute', left: pos.x, top: pos.y,
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', padding: '10px', minWidth: '160px',
        zIndex: 350, boxShadow: '0 4px 20px rgba(0,0,0,0.65)',
        color: 'var(--text-primary)', fontSize: '13px',
        cursor: 'grab', userSelect: 'none',
      }}
    >
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-heading)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Info Token</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0 2px' }}>✕</button>
      </div>
      {/* Nom du token */}
      <div style={{ marginBottom: '5px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>Nom</span>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', cursor: 'default' }}>{info.name}</span>
      </div>
      {/* Créateur */}
      <div style={{ marginBottom: '5px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block' }}>Créé par</span>
        <span style={{ fontWeight: 500, fontSize: '0.82rem', cursor: 'default' }}>{info.createdBy}</span>
      </div>
      {/* Statuts actifs — conditionnels */}
      {info.conditions?.length > 0 && (
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', display: 'block', marginBottom: '3px' }}>Statuts</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', cursor: 'default' }}>
            {info.conditions.map(condId => {
              const cond = CONDITIONS.find(c => c.id === condId);
              if (!cond) return null;
              return (
                <span key={condId} style={{ background: cond.color, borderRadius: '4px', padding: '2px 5px', fontSize: '11px', color: '#fff' }}>
                  {cond.emoji} {cond.label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default TokenInfoPanel;
