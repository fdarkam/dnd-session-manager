import { useRef } from 'react';

// Sélecteur par défaut des éléments interactifs depuis lesquels le drag ne démarre pas.
const DEFAULT_SKIP = 'button, input, select, textarea, a, label';

// ─── Logique de drag réutilisable pour les panneaux flottants ────────────────
// Factorise le startDrag identique de FloatingPanel / TokenInfoPanel / TokenEditPanel.
//  - pos / setPos : state de position {x,y} du panneau appelant.
//  - clamp(rawX, rawY) => {x,y} : borne la position selon les contraintes du panneau
//    (appelée à chaque mousemove → peut lire des dimensions live, ex. containerRef).
//  - skip : sélecteur des éléments interactifs qui ne démarrent pas le drag.
//  - onStart : callback optionnel exécuté au démarrage (ex. reporter une fermeture auto).
export function useDraggable(pos, setPos, clamp, { skip = DEFAULT_SKIP, onStart } = {}) {
  const dragRef = useRef(false);
  const oriRef = useRef({});

  const startDrag = (e) => {
    if (e.button !== 0) return;
    if (skip && e.target.closest(skip)) return;
    onStart?.();
    dragRef.current = true;
    document.body.style.cursor = 'grabbing';
    document.documentElement.style.userSelect = 'none';
    oriRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const mv = (ev) => {
      if (!dragRef.current) return;
      setPos(clamp(oriRef.current.px + ev.clientX - oriRef.current.mx, oriRef.current.py + ev.clientY - oriRef.current.my));
    };
    const up = () => {
      dragRef.current = false;
      document.body.style.cursor = '';
      document.documentElement.style.userSelect = '';
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  return startDrag;
}
