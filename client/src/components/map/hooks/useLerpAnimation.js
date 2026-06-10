import { useCallback } from 'react';
import { lerp, clamp } from '../mapConstants';

// ─── Token interpolation loop ─────────────────────────────────────────────
// Boucle d'interpolation 60fps déplacée VERBATIM depuis MapCanvas.
// Reçoit les refs (singletons depuis useMapRefs) + drawFrame. AUCUN setState
// dans le chemin chaud : tout passe par xxxRef.current + mutation DOM impérative.
// Identité de startLerpAnimation stable (useCallback dep [drawFrame]) pour ne
// pas réabonner l'effet socket qui en dépend.
export function useLerpAnimation({ refs, drawFrame }) {
  const { lerpAnimRef, tokenLerpsRef, tokenVisualsRef, cursorLerpsRef, cursorVisualsRef, tokenDivsRef, tokensRef } = refs;

  const startLerpAnimation = useCallback(() => {
    if (lerpAnimRef.current) return;
    const animate = () => {
      const now = Date.now();
      let active = false;
      Object.entries(tokenLerpsRef.current).forEach(([id, tgt]) => {
        const t = Math.min((now - tgt.startTime) / tgt.duration, 1);
        tokenVisualsRef.current[id] = { x: lerp(tgt.fromX, tgt.toX, t), y: lerp(tgt.fromY, tgt.toY, t) };
        if (t < 1) active = true;
        else delete tokenLerpsRef.current[id];
      });
      // Cursor lerp — same pattern as tokens
      Object.entries(cursorLerpsRef.current).forEach(([uid, tgt]) => {
        const t = Math.min((now - tgt.startTime) / tgt.duration, 1);
        cursorVisualsRef.current[uid] = { x: lerp(tgt.fromX, tgt.toX, t), y: lerp(tgt.fromY, tgt.toY, t) };
        if (t < 1) active = true;
        else delete cursorLerpsRef.current[uid];
      });
      // Sync token overlay div positions (impératif, sans re-render React)
      Object.entries(tokenVisualsRef.current).forEach(([id, vis]) => {
        const el = tokenDivsRef.current[id];
        if (!el) return;
        const tok = tokensRef.current.find(t => t.id === id);
        if (!tok) return;
        const r = clamp(tok.radius || 22, 10, 120);
        el.style.left = `${vis.x - r}px`;
        el.style.top = `${vis.y - r}px`;
      });
      drawFrame();
      lerpAnimRef.current = active ? requestAnimationFrame(animate) : null;
    };
    lerpAnimRef.current = requestAnimationFrame(animate);
  }, [drawFrame]);

  return startLerpAnimation;
}
