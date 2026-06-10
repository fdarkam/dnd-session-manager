import { clamp } from './mapConstants';

// ─── Token overlay ─────────────────────────────────────────────────────────
// Le .map() des divs tokens (overlay HTML au-dessus du canvas) déplacé VERBATIM
// depuis MapCanvas. Présentationnel : reçoit l'état tokens + refs partagées
// (tokenWorldRef pour le pan/zoom impératif, tokenDivsRef pour le drag DOM
// impératif du hot path). Aucune logique modifiée.
export default function TokenOverlay({ tokens, isDM, gridSize, fogCells, selectedToken, user, tokenWorldRef, tokenDivsRef }) {
  return (
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
                // Glow uniquement pour les tokens que l'utilisateur peut modifier (créateur ou MJ)
                boxShadow: (t.id === selectedToken?.id && (isDM || !t.createdBy || t.createdBy === user?.id))
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
              {/* Fix 2 : poignée de resize visible uniquement si sélectionné localement ET si le client peut modifier le token (créateur ou MJ) */}
              {t.id === selectedToken?.id && !t.locked && (isDM || !t.createdBy || t.createdBy === user?.id) && (
                <div style={{ position: 'absolute', left: r * 1.707 - 5, top: r * 1.707 - 5, width: 10, height: 10, borderRadius: '50%', background: '#facc15', border: '2px solid #000', zIndex: 1 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
