import { useEffect } from 'react';

// ─── Undo / Redo + raccourcis clavier ──────────────────────────────────────
// saveUndoState + effet clavier (Escape / Ctrl+C / Ctrl+V / Ctrl+Z / Ctrl+Y /
// Delete) déplacés VERBATIM depuis MapCanvas. Reçoit refs (depuis useMapRefs) +
// setters + drawFrame + socket + sessionId + user. Effet clavier deps
// [socket, sessionId, drawFrame] conservées à l'identique. saveUndoState est
// retourné car aussi appelé depuis les handlers souris de MapCanvas.
export function useUndoRedo({ refs, setters, drawFrame, socket, sessionId, user }) {
  const { undoStackRef, redoStackRef, tokensRef, pathsRef, fogCellsRef, selectedShapeRef, selectedTokenRef, copiedTokenRef, mouseWorldPosRef, activeMapRef, gridSizeRef, toolRef, isDMRef, mapImageRef, shapesRef } = refs;
  const { setSelectedShape, setTokens, setPaths, setFogCells, setShapes, setPendingDelete } = setters;

  // Sauvegarde l'état courant avant une mutation pour permettre l'annulation
  const saveUndoState = () => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current), shapes: [...shapesRef.current] }
    ];
    redoStackRef.current = [];
  };

  // Delete key / Ctrl+C / Ctrl+V / Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e) => {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;

      // Fix 2 — Échap : désélectionner la forme active
      if (e.key === 'Escape') {
        if (selectedShapeRef.current) {
          selectedShapeRef.current = null; setSelectedShape(null); drawFrame(); return;
        }
      }

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
        const current = { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current), shapes: [...shapesRef.current] };
        redoStackRef.current = [...redoStackRef.current.slice(-19), current];
        const prev = undoStackRef.current[undoStackRef.current.length - 1];
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        tokensRef.current = prev.tokens; setTokens(prev.tokens);
        pathsRef.current = prev.drawings; setPaths(prev.drawings);
        fogCellsRef.current = prev.fogCells; setFogCells(prev.fogCells);
        shapesRef.current = prev.shapes; setShapes(prev.shapes);
        selectedShapeRef.current = null; setSelectedShape(null);
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
        const current = { tokens: [...tokensRef.current], drawings: [...pathsRef.current], fogCells: new Set(fogCellsRef.current), shapes: [...shapesRef.current] };
        undoStackRef.current = [...undoStackRef.current.slice(-19), current];
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        tokensRef.current = next.tokens; setTokens(next.tokens);
        pathsRef.current = next.drawings; setPaths(next.drawings);
        fogCellsRef.current = next.fogCells; setFogCells(next.fogCells);
        shapesRef.current = next.shapes; setShapes(next.shapes);
        selectedShapeRef.current = null; setSelectedShape(null);
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
        const tok = selectedTokenRef.current;
        // Bloquer silencieusement si le joueur n'est pas le créateur du token ni le MJ
        const canDelete = isDMRef.current || !tok.createdBy || tok.createdBy === user?.id;
        if (!canDelete) return;
        e.preventDefault();
        setPendingDelete({ type: 'token', id: tok.id, name: tok.name });
        return;
      }
      // Suppression d'une forme sélectionnée — créateur ou MJ uniquement
      if (selectedShapeRef.current) {
        const shape = selectedShapeRef.current;
        if (isDMRef.current || shape.createdBy === user?.id) {
          e.preventDefault();
          saveUndoState();
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
  }, [socket, sessionId, drawFrame]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs), deps minimales intentionnelles

  return { saveUndoState };
}
