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
import { useAuth } from '../../contexts/AuthContext';
import DiceRoller from '../DiceRoller';
import CombatTracker from '../CombatTracker';
import FloatingPanel from '../common/FloatingPanel';
import TokenInfoPanel from './TokenInfoPanel';
import TokenEditPanel from './TokenEditPanel';
import MapToolbar from './MapToolbar';
import TokenOverlay from './TokenOverlay';
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
  const { canvasRef, cursorCanvasRef, containerRef, resizingToken, pingAnimRef, tokensRef, tokenVisualsRef, cursorVisualsRef, pathsRef, livePathsRef, currentPathRef, selectedTokenRef, panOffsetRef, zoomRef, mapImageRef, imgXRef, imgYRef, imgScaleRef, gridSizeRef, drawColorRef, drawWidthRef, fogColorRef, fogOpacityRef, fogCellsRef, isDMRef, activeMapRef, otherCursorsRef, toolRef, shapesRef, currentShapeRef, selectedShapeRef, isResizingShapeRef, showGridRef, prevMapIdRef, tokenWorldRef, tokenDivsRef, mapWorldRef, mapImgElemRef } = refs;
  const { activeMap, mapImage, imgX, imgY, imgScale, tokens, paths, fogCells, tool, gridSize, drawColor, drawWidth, fogColor, fogOpacity, dragging, editingMapImg, panOffset, showDeleteConfirm, pendingDelete, zoom, selectedToken, showTokenEdit, showDice, showCombat, editingMapName, tokenEditPos, shapes, selectedShape, renamingShape, tokenInfo } = state;
  const { setMaps, setActiveMap, setMapImage, setImgX, setImgY, setImgScale, setTokens, setPaths, setFogCells, setShowDeleteConfirm, setPendingDelete, setZoom, setSelectedToken, setShowTokenEdit, setShowDice, setShowCombat, setEditingMapName, setTokenEditPos, setShapes, setSelectedShape, setRenamingShape, setTokenInfo } = setters;

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
    let next = tokensRef.current.map(t => t.id === upd.id ? upd : t);
    // Liaison unique : un personnage ne peut être lié qu'à un seul token → retirer le lien des autres tokens
    if (upd.characterId) next = next.map(t => (t.id !== upd.id && t.characterId === upd.characterId) ? { ...t, characterId: null } : t);
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
    saveUndoState();
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

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '5px' }}>
      {/* Toolbar */}
      <MapToolbar
        state={state} setters={setters} refs={refs}
        isDM={isDM} socket={socket} sessionId={sessionId} user={user}
        drawFrame={drawFrame} resetImgTransform={resetImgTransform} clearFog={clearFog}
        updateSelectedShape={updateSelectedShape} deleteSelectedShape={deleteSelectedShape}
        uploadMap={uploadMap} deleteCurrentMap={deleteCurrentMap} switchMap={switchMap} saveMapName={saveMapName}
      />

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
        {/* Token overlay → extrait dans TokenOverlay */}
        <TokenOverlay
          tokens={tokens} isDM={isDM} gridSize={gridSize} fogCells={fogCells}
          selectedToken={selectedToken} user={user}
          tokenWorldRef={tokenWorldRef} tokenDivsRef={tokenDivsRef}
        />
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
        {selectedToken && showTokenEdit && <TokenEditPanel token={selectedToken} isDM={isDM} sessionId={sessionId} linkedCharacterIds={tokens.filter(t => t.id !== selectedToken.id && t.characterId).map(t => t.characterId)} onUpdate={updateToken} onDelete={() => setPendingDelete({ type: 'token', id: selectedToken.id, name: selectedToken.name })} onClose={() => { setSelectedToken(null); selectedTokenRef.current = null; setShowTokenEdit(false); drawFrame(); }} initialPos={tokenEditPos} onToggleCondition={toggleCondition} />}
      </div>
    </div>
  );
}
