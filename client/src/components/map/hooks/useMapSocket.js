import { useEffect } from 'react';

// ─── Socket listeners ─────────────────────────────────────────────────────
// Effet socket entier copié VERBATIM depuis MapCanvas : 25 on/off, handlers,
// hasConnectedRef local, deps [socket, startLerpAnimation, drawFrame] à l'identique.
export function useMapSocket({ socket, refs, setters, startLerpAnimation, drawFrame, loadFog, loadImgTransform }) {
  const { pingAnimRef, fetchMapsRef, tokensRef, tokenVisualsRef, tokenLerpsRef, cursorVisualsRef, cursorLerpsRef, pathsRef, livePathsRef, mapImageRef, imgXRef, imgYRef, imgScaleRef, gridSizeRef, fogCellsRef, activeMapRef, otherCursorsRef, shapesRef, selectedShapeRef } = refs;
  const { setMaps, setActiveMap, setMapImage, setImgX, setImgY, setImgScale, setTokens, setPaths, setFogCells, setGridSize, setShapes, setSelectedShape } = setters;

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
    // Forme mise à jour par un autre joueur (déplacée, propriété modifiée) — Fix 2 & 3
    const onShapeUpdated = ({ mapId, shape }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const next = shapesRef.current.map(s => s.id === shape.id ? shape : s);
      shapesRef.current = next; setShapes(next);
      if (selectedShapeRef.current?.id === shape.id) { selectedShapeRef.current = shape; setSelectedShape(shape); }
      drawFrame();
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
    // Synchro des statuts de combat vers les conditions du token lié par characterId
    // Le serveur émet l'objet encounter brut (pas enveloppé) — même payload que CombatTracker
    const onCombatUpdated = (encounter) => {
      if (!encounter?.entities) return;
      let changed = false;
      const updated = tokensRef.current.map(tok => {
        if (!tok.characterId) return tok;
        const entity = encounter.entities.find(e => e.characterId === tok.characterId);
        if (!entity?.statuses) return tok;
        changed = true;
        return { ...tok, conditions: entity.statuses };
      });
      if (!changed) return;
      tokensRef.current = updated;
      setTokens(updated);
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
    socket.on('map-shape-updated', onShapeUpdated);
    socket.on('map-shape-deleted', onShapeDeleted);
    socket.on('combat-updated', onCombatUpdated);
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
      socket.off('map-shape-updated', onShapeUpdated);
      socket.off('map-shape-deleted', onShapeDeleted);
      socket.off('combat-updated', onCombatUpdated);
      socket.off('map-sync', onMapSync);
    };
  }, [socket, startLerpAnimation, drawFrame]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs) ; deps minimales pour identité stable / anti-fuite de listeners
}
