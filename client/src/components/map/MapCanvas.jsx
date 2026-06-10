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

import { useEffect } from 'react';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth, API } from '../../contexts/AuthContext';
const VITE_API = import.meta.env.VITE_API_URL;
import DiceRoller from '../DiceRoller';
import CombatTracker from '../CombatTracker';
import FloatingPanel from '../common/FloatingPanel';
import TokenInfoPanel from './TokenInfoPanel';
import TokenEditPanel from './TokenEditPanel';
import { clamp } from './mapConstants';
import { useMapRefs } from './hooks/useMapRefs';
import { useMapSocket } from './hooks/useMapSocket';
import { useLerpAnimation } from './hooks/useLerpAnimation';
import { useFog } from './hooks/useFog';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useMapData } from './hooks/useMapData';
import { useMapInput } from './hooks/useMapInput';
import { useDrawFrame } from './drawing/drawFrame';

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapCanvas({ sessionId, isDM }) {
  const socket = useSocket();
  const { token, user } = useAuth();
  const { refs, state, setters } = useMapRefs(isDM);
  const { canvasRef, cursorCanvasRef, containerRef, resizingToken, pingAnimRef, tokensRef, tokenVisualsRef, cursorVisualsRef, pathsRef, livePathsRef, currentPathRef, selectedTokenRef, panOffsetRef, zoomRef, mapImageRef, imgXRef, imgYRef, imgScaleRef, gridSizeRef, drawColorRef, drawWidthRef, fogColorRef, fogOpacityRef, fogCellsRef, fogBrushPxRef, isDMRef, activeMapRef, otherCursorsRef, toolRef, shapesRef, currentShapeRef, selectedShapeRef, isResizingShapeRef, shapeTypeRef, shapeColorRef, shapeWidthRef, shapeFilledRef, shapeOpacityRef, showGridRef, newTokenFileRef, prevMapIdRef, tokenWorldRef, tokenDivsRef, mapWorldRef, mapImgElemRef } = refs;
  const { maps, activeMap, mapImage, imgX, imgY, imgScale, tokens, paths, fogCells, tool, gridSize, drawColor, drawWidth, eraserSize, fogBrushPx, fogColor, fogOpacity, showGrid, dragging, editingMapImg, panOffset, showDeleteConfirm, pendingDelete, zoom, selectedToken, showTokenEdit, showDice, showCombat, editingMapName, newTokenName, newTokenColor, newTokenBorderColor, newTokenRadius, newTokenImage, newTokenHidden, tokenEditPos, shapes, selectedShape, shapeType, shapeColor, shapeWidth, shapeFilled, shapeOpacity, newShapeName, renamingShape, tokenInfo } = state;
  const { setMaps, setActiveMap, setMapImage, setImgX, setImgY, setImgScale, setTokens, setPaths, setFogCells, setTool, setGridSize, setDrawColor, setDrawWidth, setEraserSize, setFogBrushPx, setFogColor, setFogOpacity, setShowGrid, setShowDeleteConfirm, setPendingDelete, setZoom, setSelectedToken, setShowTokenEdit, setShowDice, setShowCombat, setEditingMapName, setNewTokenName, setNewTokenColor, setNewTokenBorderColor, setNewTokenRadius, setNewTokenImage, setNewTokenHidden, setTokenEditPos, setShapes, setSelectedShape, setShapeType, setShapeColor, setShapeWidth, setShapeFilled, setShapeOpacity, setNewShapeName, setRenamingShape, setTokenInfo } = setters;

  const drawFrame = useDrawFrame({ canvasRef, containerRef, cursorCanvasRef, panOffsetRef, zoomRef, gridSizeRef, mapImageRef, isDMRef, fogCellsRef, tokenWorldRef, mapWorldRef, mapImgElemRef, imgXRef, imgYRef, imgScaleRef, toolRef, showGridRef, pathsRef, livePathsRef, currentPathRef, drawColorRef, drawWidthRef, fogColorRef, fogOpacityRef, shapesRef, selectedShapeRef, currentShapeRef, tokensRef, tokenVisualsRef, pingAnimRef, otherCursorsRef, cursorVisualsRef });

  // ─── Token interpolation loop ─────────────────────────────────────────────
  const startLerpAnimation = useLerpAnimation({ refs, drawFrame });

  // ─── ResizeObserver: initial draw when container gets its size ───────────
  useEffect(() => {
    const c = containerRef.current; if (!c) return;
    const obs = new ResizeObserver(() => drawFrame());
    obs.observe(c);
    return () => obs.disconnect();
  }, [drawFrame]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs), deps minimales intentionnelles

  // Redraw on state changes (shapes et selectedShape inclus pour les conditions et formes)
  useEffect(() => { drawFrame(); }, [tokens, paths, shapes, selectedShape, panOffset, zoom, mapImage, imgX, imgY, imgScale, fogCells, gridSize, drawColor, drawWidth, fogColor, fogOpacity, tool, drawFrame]);

  // Fog (revealFogForToken / paintFog / loadFog) extrait dans useFog
  const { revealFogForToken, paintFog, loadFog } = useFog({ refs, setters, drawFrame });
  // saveUndoState + effet clavier (Escape/Ctrl+C/V/Z/Y/Delete) extraits dans useUndoRedo
  const { saveUndoState } = useUndoRedo({ refs, setters, drawFrame, socket, sessionId, user });

  // loadImgTransform : défini avant useMapSocket pour être passé en argument sans TDZ.
  // (loadFog provient de useFog ci-dessus.)
  const loadImgTransform = (map) => {
    const x = map.img_x || 0, y = map.img_y || 0, s = map.img_scale || 1;
    setImgX(x); setImgY(y); setImgScale(s);
  };

  // ─── Socket listeners → extraits dans useMapSocket ───
  useMapSocket({ socket, refs, setters, startLerpAnimation, drawFrame, loadFog, loadImgTransform });

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
  }, [activeMap, drawFrame]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs) ; rechargement piloté par activeMap uniquement


  // CRUD maps (fetchMaps + fetchMapsRef + effet initial + uploadMap + delete) extrait dans useMapData
  const { uploadMap, deleteCurrentMap, confirmDeleteMap, switchMap } = useMapData({ refs, setters, socket, sessionId, token, isDM });

  // ─── Helpers ─────────────────────────────────────────────────────────────
  // getWorldPos / snapPos / getMapImgHit → extraits dans useMapInput
  const emitImgTransform = (x, y, s) => {
    if (!socket || !activeMapRef.current) return;
    socket.emit('map-image-transform', { sessionId, mapId: activeMapRef.current.id, img_x: Math.round(x), img_y: Math.round(y), img_scale: s });
  };

  // ─── Mouse handlers → extraits dans useMapInput (chemin chaud souris) ──────
  const { handleMouseDown, handleMouseMove, handleMouseUp } = useMapInput({
    refs, state, setters, socket, sessionId, isDM, user,
    drawFrame, saveUndoState, paintFog, revealFogForToken, emitImgTransform,
  });

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
  }, [drawFrame]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs), deps minimales intentionnelles

  // ─── Double-clic : panel d'édition (propriétaire/MJ) ou tooltip créateur ────
  // Utilise l'événement natif dblclick plutôt qu'une détection temporelle dans
  // mouseUp, car les tokens non-gérables ne passent jamais dans isDraggingRef
  // (handleMouseDown n'assigne le ref que si canManage est vrai).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onDblClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const pan = panOffsetRef.current, z = zoomRef.current;
      // Convertir les coordonnées écran en coordonnées monde (pan + zoom)
      const worldX = (e.clientX - rect.left - pan.x) / z;
      const worldY = (e.clientY - rect.top - pan.y) / z;
      // Trouver le token sous le curseur (même rayon+tolérance que handleMouseDown)
      const tok = tokensRef.current.find(t => {
        if (t.hidden && !isDMRef.current) return false;
        const r = clamp(t.radius || 22, 10, 120);
        const dx = t.x - worldX, dy = t.y - worldY;
        return dx * dx + dy * dy <= (r + 5) ** 2;
      });
      if (!tok) return;
      const canManageTok = isDMRef.current || !tok.createdBy || tok.createdBy === user?.id;
      if (canManageTok) {
        // MJ ou créateur du token : ouvrir le panneau d'édition
        const r = clamp(tok.radius || 22, 10, 120);
        const panelW = 248;
        const contW = containerRef.current?.clientWidth || 600;
        const contH = containerRef.current?.clientHeight || 400;
        const tokSx = tok.x * z + pan.x;
        const tokSy = tok.y * z + pan.y;
        const sx = (tokSx + r + 12 + panelW < contW) ? tokSx + r + 12 : Math.max(8, tokSx - r - panelW - 12);
        const sy = Math.max(8, Math.min(contH - 280, tokSy - r));
        setTokenEditPos({ x: Math.max(8, sx), y: sy });
        setShowTokenEdit(true);
      } else {
        // Autre joueur : fenêtre info token (lecture seule, draggable, fermeture auto 5 s)
        // Positionnée à côté du token en restant dans les bords du container
        const r = clamp(tok.radius || 22, 10, 120);
        const infoW = 175;
        const contW = containerRef.current?.clientWidth || 600;
        const contH = containerRef.current?.clientHeight || 400;
        const tokSx = tok.x * z + pan.x;
        const tokSy = tok.y * z + pan.y;
        const sx = (tokSx + r + 10 + infoW < contW) ? tokSx + r + 10 : Math.max(8, tokSx - r - infoW - 10);
        const sy = Math.max(8, Math.min(contH - 160, tokSy - r));
        setTokenInfo({
          x: Math.max(8, sx),
          y: sy,
          name: tok.name || '?',
          createdBy: tok.createdByName || tok.created_by_username || tok.createdBy || '?',
          conditions: tok.conditions || [],
        });
      }
    };
    canvas.addEventListener('dblclick', onDblClick);
    return () => canvas.removeEventListener('dblclick', onDblClick);
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps -- user.id requis pour la vérif de propriété ; refs stables (useMapRefs), deps minimales

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

  // Fix 3 — met à jour une propriété de la forme sélectionnée et synchronise via socket
  const updateSelectedShape = (updates) => {
    if (!selectedShapeRef.current) return;
    const updated = { ...selectedShapeRef.current, ...updates };
    const next = shapesRef.current.map(s => s.id === updated.id ? updated : s);
    shapesRef.current = next; setShapes(next);
    selectedShapeRef.current = updated; setSelectedShape(updated);
    drawFrame();
    if (socket && activeMapRef.current)
      socket.emit('map-shape-update', { sessionId, mapId: activeMapRef.current.id, shape: updated, live: false });
  };

  // Fix 3 — supprime la forme sélectionnée (MJ ou créateur uniquement)
  const deleteSelectedShape = () => {
    const shape = selectedShapeRef.current;
    if (!shape) return;
    const next = shapesRef.current.filter(s => s.id !== shape.id);
    shapesRef.current = next; setShapes(next);
    selectedShapeRef.current = null; setSelectedShape(null);
    drawFrame();
    if (socket && activeMapRef.current)
      socket.emit('map-shape-delete', { sessionId, mapId: activeMapRef.current.id, shapeId: shape.id });
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
    if (resizingToken.current || isResizingShapeRef.current) return 'nwse-resize';
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
      {/* eslint-disable-next-line react-hooks/refs -- getCursor lit resizingToken/isResizingShapeRef (refs stables) en render-only, sans effet de bord */}
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
        {/* Canvas curseurs — positionné APRÈS l'overlay token dans le DOM = z-index supérieur aux tokens */}
        {/* pointerEvents:none → les clics continuent de passer au canvas principal */}
        <canvas
          ref={cursorCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
        />
        {/* Fenêtre info token — double clic sur un token non-éditable par ce joueur */}
        {tokenInfo && (
          <TokenInfoPanel
            info={tokenInfo}
            onClose={() => setTokenInfo(null)}
            containerRef={containerRef}
          />
        )}
        {/* Fix 5 — input inline de renommage d'une forme, positionné directement sur le canvas */}
        {renamingShape && (
          <input
            autoFocus
            defaultValue={renamingShape.name}
            style={{
              position: 'absolute',
              left: renamingShape.left,
              top: renamingShape.top,
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.85)',
              color: 'white',
              border: '1px solid #facc15',
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '12px',
              textAlign: 'center',
              zIndex: 500,
              minWidth: '80px',
              outline: 'none',
            }}
            onBlur={e => { updateSelectedShape({ name: e.target.value }); setRenamingShape(null); }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenamingShape(null); }}
          />
        )}
        {showDice && <FloatingPanel title="🎲 Dés" defaultPos={{ x: 16, y: 16 }} defaultSize={{ w: 300, h: 480 }} onClose={() => setShowDice(false)}><DiceRoller sessionId={sessionId} /></FloatingPanel>}
        {showCombat && <FloatingPanel title="⚔️ Combat" defaultPos={{ x: 16, y: showDice ? 450 : 16 }} defaultSize={{ w: 340, h: 540 }} onClose={() => setShowCombat(false)}><CombatTracker sessionId={sessionId} isDM={isDM} /></FloatingPanel>}
        {selectedToken && showTokenEdit && <TokenEditPanel token={selectedToken} isDM={isDM} sessionId={sessionId} onUpdate={updateToken} onDelete={() => setPendingDelete({ type: 'token', id: selectedToken.id, name: selectedToken.name })} onClose={() => { setSelectedToken(null); selectedTokenRef.current = null; setShowTokenEdit(false); drawFrame(); }} initialPos={tokenEditPos} onToggleCondition={toggleCondition} />}
      </div>
    </div>
  );
}
