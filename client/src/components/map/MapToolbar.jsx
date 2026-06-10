import { clamp } from './mapConstants';
import { apiPost } from '../../api/client';
const VITE_API = import.meta.env.VITE_API_URL;

// ─── Map toolbar ───────────────────────────────────────────────────────────
// Toute la JSX de la toolbar déplacée VERBATIM depuis MapCanvas. Présentationnel :
// reçoit les bundles state/setters/refs (singletons depuis useMapRefs) + le
// contexte (isDM/socket/sessionId/user/token) et les handlers dérivés de
// MapCanvas. dmTools (dérivé pur de isDM) vit ici car utilisé uniquement ici.
// Aucune logique modifiée.
export default function MapToolbar({ state, setters, refs, isDM, socket, sessionId, user, drawFrame, resetImgTransform, clearFog, updateSelectedShape, deleteSelectedShape, uploadMap, deleteCurrentMap, switchMap, saveMapName }) {
  const { tool, drawColor, drawWidth, eraserSize, fogBrushPx, fogColor, fogCells, fogOpacity, selectedShape, shapeType, shapeColor, shapeWidth, shapeFilled, shapeOpacity, newShapeName, newTokenName, newTokenColor, newTokenBorderColor, newTokenRadius, newTokenImage, newTokenHidden, showGrid, gridSize, showCombat, showDice, maps, activeMap, editingMapName, zoom } = state;
  const { setTool, setDrawColor, setDrawWidth, setPaths, setEraserSize, setFogBrushPx, setFogColor, setFogOpacity, setSelectedShape, setShapeType, setNewShapeName, setShapeColor, setShapeWidth, setShapeFilled, setShapeOpacity, setNewTokenName, setNewTokenColor, setNewTokenBorderColor, setNewTokenRadius, setNewTokenImage, setNewTokenHidden, setShowGrid, setGridSize, setShowCombat, setShowDice, setEditingMapName } = setters;
  const { pathsRef, activeMapRef, fogBrushPxRef, fogOpacityRef, selectedShapeRef, shapeTypeRef, shapeColorRef, shapeWidthRef, shapeFilledRef, shapeOpacityRef, newTokenFileRef, showGridRef, gridSizeRef } = refs;

  const dmTools = isDM ? [
    { id: 'draw', icon: '✏️', label: 'Dessiner' }, { id: 'erase', icon: '🧹', label: 'Gomme dessin' },
    { id: 'token', icon: '📍', label: 'Token' }, { id: 'map-edit', icon: '🖼️', label: 'Déplacer/redimensionner image' },
    { id: 'fog-add', icon: '🌫️', label: 'Brouillard +' }, { id: 'fog-erase', icon: '🌤️', label: 'Brouillard −' },
    { id: 'shape', icon: '🔮', label: 'Formes de sorts' },
  ] : [
    { id: 'token', icon: '📍', label: 'Token' },
    { id: 'shape', icon: '🔮', label: 'Formes de sorts' },
  ];

  return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', padding: '5px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>

        <div style={{ display: 'flex', gap: '2px' }}>
          {[{ id: 'move', icon: '✋', label: 'Déplacer' }, ...dmTools].map(t => (
            <button key={t.id} className={`btn btn-sm ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTool(tool === t.id ? 'move' : t.id)} title={t.label} style={{ fontSize: '0.9rem' }}>{t.icon}</button>
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
        {/* toolbar contextuelle quand une forme est sélectionnée */}
        {selectedShape ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {/* Fix 2 — nom éditable directement dans la toolbar (sync temps réel via socket) */}
            <input
              type="text"
              placeholder="Nom du sort..."
              value={selectedShape.name || ''}
              onChange={e => updateSelectedShape({ name: e.target.value })}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #555', borderRadius: '4px', color: 'white', padding: '3px 8px', fontSize: '12px', width: '120px' }}
            />
            <input type="color" value={selectedShape.color}
              onChange={e => updateSelectedShape({ color: e.target.value })}
              style={{ width: '24px', height: '22px', padding: 0, border: 'none', cursor: 'pointer' }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              Épais.
              <input type="range" min="1" max="10" value={selectedShape.width}
                onChange={e => updateSelectedShape({ width: +e.target.value })}
                style={{ width: '55px', cursor: 'pointer' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              Opacité
              <input type="range" min="0.1" max="1" step="0.1" value={selectedShape.opacity}
                onChange={e => updateSelectedShape({ opacity: +e.target.value })}
                style={{ width: '55px', cursor: 'pointer' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={selectedShape.filled}
                onChange={e => updateSelectedShape({ filled: e.target.checked })} />
              Rempli
            </label>
            {(isDM || selectedShape.createdBy === user?.id) && (
              <button className="btn btn-sm btn-danger" onClick={deleteSelectedShape} title="Supprimer la forme">🗑️</button>
            )}
            <button className="btn btn-sm btn-secondary"
              onClick={() => { selectedShapeRef.current = null; setSelectedShape(null); drawFrame(); }}
              title="Désélectionner (Échap)">✕</button>
          </div>
        ) : tool === 'shape' && (
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
            {/* Fix 4 — champ nom optionnel pour la forme à créer */}
            <input type="text" value={newShapeName} onChange={e => setNewShapeName(e.target.value)}
              placeholder="Nom (opt.)" style={{ width: '90px', padding: '2px 5px', fontSize: '0.8rem' }} />
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
                const res = await apiPost('/maps/token-image', fd);
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
  );
}
