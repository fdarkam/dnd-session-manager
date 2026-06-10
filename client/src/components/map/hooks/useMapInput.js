import { clamp } from '../mapConstants';
import { getClickedHandle, hitTestShape } from '../geometry';

// ─── Mouse input (hot path) ────────────────────────────────────────────────
// handleMouseDown / handleMouseMove / handleMouseUp + helpers privés
// (getWorldPos / snapPos / getMapImgHit) déplacés VERBATIM depuis MapCanvas.
//
// Pattern 60fps préservé à l'identique :
//  - le hot path token-drag écrit dans xxxRef.current + mute le DOM impératif
//    (dragEl.style.left/top) + drawFrame() ; AUCUN setState.
//  - les 4 seuls setState de handleMouseMove sont les existants/volontaires :
//    setPaths (gomme), setTokens + setSelectedToken (resize token),
//    setFogCells (sync fog révélé toutes les 50ms).
//  - throttles inchangés : 16ms (token/shape/draw/img-transform), 50ms (fog
//    reveal), 100ms (curseur, fog-live).
//
// Reçoit les objets complets refs/state/setters (singletons depuis useMapRefs,
// jamais recréés ici) + le contexte et les fonctions dérivées. emitImgTransform
// vient de MapCanvas (partagé avec resetImgTransform). Les handlers ne sont pas
// mémoïsés (recréés à chaque render comme l'original ; ils ne sont dans aucun
// tableau de deps, juste passés aux props JSX onMouse*).
export function useMapInput({ refs, state, setters, socket, sessionId, isDM, user, drawFrame, saveUndoState, paintFog, revealFogForToken, emitImgTransform }) {
  const { canvasRef, fogPainting, eraserActive, resizingToken, dragMoved, lastDragEmit, lastCursorEmit, lastDrawEmit, lastFogEmit, lastImgTransformEmit, panStartRef, isDrawingRef, isPanningRef, isDraggingRef, tokensRef, tokenVisualsRef, pathsRef, currentPathRef, currentPathIdRef, selectedTokenRef, panOffsetRef, zoomRef, mapImageRef, imgXRef, imgYRef, imgScaleRef, gridSizeRef, drawColorRef, drawWidthRef, fogCellsRef, activeMapRef, toolRef, mouseWorldPosRef, shapesRef, currentShapeRef, selectedShapeRef, isDrawingShapeRef, isDraggingShapeRef, isResizingShapeRef, activeHandleRef, lastShapeDragEmit, shapeLastClickRef, shapeTypeRef, shapeColorRef, shapeWidthRef, shapeFilledRef, shapeOpacityRef, lastFogUpdateRef, tokenDivsRef } = refs;
  const { eraserSize, drawing, editingMapImg, newTokenName, newTokenColor, newTokenBorderColor, newTokenRadius, newTokenImage, newTokenHidden, newShapeName, tokenInfo } = state;
  const { setImgX, setImgY, setImgScale, setTokens, setPaths, setFogCells, setDrawing, setDragging, setEditingMapImg, setIsPanning, setPanOffset, setSelectedToken, setShowTokenEdit, setShapes, setSelectedShape, setRenamingShape, setTokenInfo } = setters;

  const getWorldPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const pan = panOffsetRef.current, z = zoomRef.current;
    return { x: (e.clientX - rect.left - pan.x) / z, y: (e.clientY - rect.top - pan.y) / z };
  };
  const snapPos = (x, y) => ({ x, y });
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

  // ─── Mouse handlers ───────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    // Fermer la fenêtre info token au prochain clic sur le canvas
    if (tokenInfo) setTokenInfo(null);
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
        name: newShapeName || '', // Fix 4 — nom optionnel
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
      // Poignées de resize de la forme sélectionnée : priorité avant drag et clic
      const selShape = selectedShapeRef.current;
      if (selShape) {
        const clickedHandle = getClickedHandle(selShape, pos, 10 / zoomRef.current);
        if (clickedHandle) {
          activeHandleRef.current = clickedHandle;
          isResizingShapeRef.current = true;
          return;
        }
      }
      // clic/double clic sur une forme : sélection, drag, renommage
      const clickedShape = shapesRef.current.find(s => hitTestShape(s, pos, 12 / zoomRef.current));
      if (clickedShape) {
        const nowMs = Date.now();
        const last = shapeLastClickRef.current;
        if (last.id === clickedShape.id && (nowMs - last.time) < 350) {
          // Fix 5 — double clic : afficher input de renommage inline au-dessus du canvas
          const z = zoomRef.current, pan = panOffsetRef.current;
          const sh = clickedShape;
          let nameX, nameY;
          switch (sh.type) {
            case 'circle': {
              const r = Math.hypot(sh.x2 - sh.x, sh.y2 - sh.y);
              nameX = sh.x * z + pan.x; nameY = (sh.y + r) * z + pan.y + 6; break;
            }
            default:
              nameX = ((sh.x + sh.x2) / 2) * z + pan.x;
              nameY = Math.max(sh.y, sh.y2) * z + pan.y + 6; break;
          }
          setRenamingShape({ id: clickedShape.id, name: clickedShape.name || '', left: nameX, top: nameY });
          shapeLastClickRef.current = { id: null, time: 0 };
          return;
        }
        shapeLastClickRef.current = { id: clickedShape.id, time: nowMs };
        selectedShapeRef.current = clickedShape; setSelectedShape(clickedShape);
        selectedTokenRef.current = null; setSelectedToken(null); setShowTokenEdit(false);
        // Fix 2 — démarrer le drag de la forme sélectionnée
        isDraggingShapeRef.current = { shape: clickedShape, startX: pos.x, startY: pos.y, origX: clickedShape.x, origY: clickedShape.y, origX2: clickedShape.x2, origY2: clickedShape.y2 };
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
    // Redimensionnement d'une forme selon la poignée active
    if (isResizingShapeRef.current && selectedShapeRef.current) {
      const shape = selectedShapeRef.current;
      const handle = activeHandleRef.current;
      const updated = { ...shape };
      switch (shape.type) {
        case 'circle':
          // Cercle : x2/y2 pointe vers la souris → rayon = distance centre-souris
          updated.x2 = pos.x; updated.y2 = pos.y; break;
        case 'rectangle':
          if (handle.id === 'tl') { updated.x = pos.x;  updated.y = pos.y;  }
          if (handle.id === 'tr') { updated.x2 = pos.x; updated.y = pos.y;  }
          if (handle.id === 'bl') { updated.x = pos.x;  updated.y2 = pos.y; }
          if (handle.id === 'br') { updated.x2 = pos.x; updated.y2 = pos.y; }
          break;
        case 'line':
        case 'cone':
          if (handle.id === 'start' || handle.id === 'origin') { updated.x = pos.x;  updated.y = pos.y;  }
          if (handle.id === 'end'   || handle.id === 'tip')    { updated.x2 = pos.x; updated.y2 = pos.y; }
          break;
      }
      const next = shapesRef.current.map(s => s.id === shape.id ? updated : s);
      shapesRef.current = next;
      selectedShapeRef.current = updated;
      drawFrame();
      if (socket && now - lastShapeDragEmit.current > 16) {
        lastShapeDragEmit.current = now;
        if (activeMapRef.current) socket.emit('map-shape-update', { sessionId, mapId: activeMapRef.current.id, shape: updated, live: true });
      }
      return;
    }
    // déplacement d'une forme sélectionnée (throttle ~60fps)
    if (isDraggingShapeRef.current) {
      const { shape, startX, startY, origX, origY, origX2, origY2 } = isDraggingShapeRef.current;
      const dx = pos.x - startX, dy = pos.y - startY;
      const updated = { ...shape, x: origX + dx, y: origY + dy, x2: origX2 + dx, y2: origY2 + dy };
      const next = shapesRef.current.map(s => s.id === shape.id ? updated : s);
      shapesRef.current = next;
      selectedShapeRef.current = updated;
      drawFrame();
      if (socket && now - lastShapeDragEmit.current > 16) {
        lastShapeDragEmit.current = now;
        if (activeMapRef.current) socket.emit('map-shape-update', { sessionId, mapId: activeMapRef.current.id, shape: updated, live: true });
      }
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
    // Fin du resize d'une forme : reset des refs + sync React state + emit final
    if (isResizingShapeRef.current) {
      isResizingShapeRef.current = false;
      activeHandleRef.current = null;
      const shape = selectedShapeRef.current;
      setShapes([...shapesRef.current]);
      if (shape) {
        setSelectedShape(shape);
        if (socket && activeMapRef.current)
          socket.emit('map-shape-update', { sessionId, mapId: activeMapRef.current.id, shape, live: false });
      }
      drawFrame();
    }
    // fin du drag d'une forme : sync React state + emit final (DB write côté serveur)
    if (isDraggingShapeRef.current) {
      const updatedShape = selectedShapeRef.current;
      isDraggingShapeRef.current = null;
      setShapes([...shapesRef.current]);
      setSelectedShape(updatedShape);
      if (updatedShape && socket && activeMapRef.current)
        socket.emit('map-shape-update', { sessionId, mapId: activeMapRef.current.id, shape: updatedShape, live: false });
      drawFrame();
    }
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
    if (wasPanning) setPanOffset({ ...panOffsetRef.current }); // sync state once after pan (deferred from mousemove)
    setDrawing(false); setIsPanning(false); setDragging(null); drawFrame();
  };

  return { handleMouseDown, handleMouseMove, handleMouseUp };
}
