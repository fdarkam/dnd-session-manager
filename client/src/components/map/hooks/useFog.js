import { VISION_NORMAL, VISION_ENHANCED } from '../mapConstants';

// ─── Fog of war ───────────────────────────────────────────────────────────
// revealFogForToken / paintFog / loadFog déplacés VERBATIM depuis MapCanvas.
// Reçoit refs (singletons depuis useMapRefs) + setters + drawFrame.
// paintFog conserve son setFogCells existant (sync fog volontaire) — aucun
// setState nouveau introduit dans le chemin chaud.
export function useFog({ refs, setters, drawFrame }) {
  const { gridSizeRef, fogCellsRef, fogBrushPxRef, mapImageRef, imgXRef, imgYRef, imgScaleRef } = refs;
  const { setFogCells, setGridSize } = setters;

  // Révèle le fog MJ dans le radius d'un token joueur — retire les cellules de fogCellsRef.
  // Cercle parfait : tolérance +0.5 pour inclure les cellules tangentes au bord du rayon.
  const revealFogForToken = (tok) => {
    const gs = gridSizeRef.current;
    // Fix 3 : tokens cachés ou aveugles (visionRadius === 0) n'effacent jamais le fog
    if (gs <= 0 || !tok || tok.hidden || tok.type === 'enemy' || tok.visionRadius === 0) return [];
    const removed = [];
    // Rayon : 'enhanced' ou nightVision (rétrocompat anciens tokens) → 6 cases, sinon 3 cases
    const vr = (tok.visionRadius === 'enhanced' || (tok.visionRadius === undefined && tok.nightVision)) ? VISION_ENHANCED : VISION_NORMAL;
    const tcx = Math.floor(tok.x / gs);
    const tcy = Math.floor(tok.y / gs);
    for (let dx = -vr; dx <= vr; dx++) {
      for (let dy = -vr; dy <= vr; dy++) {
        if (Math.sqrt(dx * dx + dy * dy) <= vr + 0.5) {
          const key = `${tcx + dx},${tcy + dy}`;
          if (fogCellsRef.current.has(key)) {
            fogCellsRef.current.delete(key);
            removed.push(key);
          }
        }
      }
    }
    return removed;
  };

  const paintFog = (wx, wy, adding) => {
    const half = fogBrushPxRef.current / 2, gs = gridSizeRef.current;
    if (gs <= 0) return;
    const cx0 = Math.floor((wx - half) / gs), cy0 = Math.floor((wy - half) / gs);
    const cx1 = Math.floor((wx + half) / gs), cy1 = Math.floor((wy + half) / gs);
    const next = new Set(fogCellsRef.current);
    // Bounds de l'image — le fog ne peut être ajouté qu'à l'intérieur de la map
    const img = mapImageRef.current;
    const imgLeft   = img ? imgXRef.current : -Infinity;
    const imgRight  = img ? imgXRef.current + img.naturalWidth  * imgScaleRef.current : Infinity;
    const imgTop    = img ? imgYRef.current : -Infinity;
    const imgBottom = img ? imgYRef.current + img.naturalHeight * imgScaleRef.current : Infinity;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        if (adding) {
          // Vérifier que le centre de la cellule est dans les bounds de l'image avant d'ajouter
          const centerX = cx * gs + gs / 2;
          const centerY = cy * gs + gs / 2;
          if (centerX >= imgLeft && centerX <= imgRight && centerY >= imgTop && centerY <= imgBottom)
            next.add(`${cx},${cy}`);
        } else {
          next.delete(`${cx},${cy}`);
        }
      }
    }
    fogCellsRef.current = next; setFogCells(next); drawFrame();
  };

  const loadFog = (map) => {
    try {
      const raw = JSON.parse(map.fog_data || '[]');
      // Format ancien : tableau simple. Format nouveau : {cells, gs}
      const cells = Array.isArray(raw) ? raw : (raw.cells || []);
      const gs    = Array.isArray(raw) ? null : raw.gs;
      const s = new Set(cells);
      fogCellsRef.current = s; setFogCells(s);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
    } catch { fogCellsRef.current = new Set(); setFogCells(new Set()); }
  };

  return { revealFogForToken, paintFog, loadFog };
}
