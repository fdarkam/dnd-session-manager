import { useCallback, useEffect } from 'react';
import { apiGet, apiPost, apiDelete } from '../../../api/client';

// ─── Map CRUD ───────────────────────────────────────────────────────────────
// fetchMaps / uploadMap / deleteCurrentMap / confirmDeleteMap / switchMap
// déplacés VERBATIM depuis MapCanvas. Le maintien de fetchMapsRef.current (lu
// par l'effet socket onConnect sans l'ajouter à ses deps) et l'effet de
// chargement initial sont conservés ici. Reçoit refs + setters + socket +
// sessionId + token + isDM.
export function useMapData({ refs, setters, socket, sessionId, token, isDM }) {
  const { fetchMapsRef, activeMapRef, tokensRef } = refs;
  const { setMaps, setActiveMap, setShowDeleteConfirm } = setters;

  const fetchMaps = useCallback(async () => {
    const res = await apiGet(`/maps/session/${sessionId}`);
    if (res.ok) {
      const data = await res.json(); setMaps(data);
      if (!activeMapRef.current || !data.find(m => m.id === activeMapRef.current.id)) {
        const a = data.find(m => m.is_active) || data[0];
        setActiveMap(a || null); // null clears map when all maps deleted
      }
    }
  }, [sessionId, token]); // eslint-disable-line react-hooks/exhaustive-deps -- refs stables (useMapRefs), deps minimales intentionnelles
  // eslint-disable-next-line react-hooks/refs -- fetchMapsRef stable (useMapRefs) ; maj en render lue par l'effet socket onConnect
  fetchMapsRef.current = fetchMaps; // keep ref fresh without adding to socket effect deps
  useEffect(() => { fetchMaps(); }, [fetchMaps]);

  const uploadMap = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('image', f); fd.append('session_id', sessionId); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
    const res = await apiPost('/maps', fd);
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
    const res = await apiDelete(`/maps/${mapId}`);
    if (res.ok) {
      if (socket) socket.emit('map-delete', { sessionId, mapId });
      fetchMaps();
    }
  };

  const switchMap = (sel) => {
    if (!isDM || sel.id === activeMapRef.current?.id) return;
    setActiveMap(sel);
    if (socket) socket.emit('map-change', { sessionId, mapId: sel.id, currentMapId: activeMapRef.current?.id, tokens: tokensRef.current });
  };

  return { uploadMap, deleteCurrentMap, confirmDeleteMap, switchMap };
}
