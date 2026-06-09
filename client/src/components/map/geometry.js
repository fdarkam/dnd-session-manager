// ─── Poignées de redimensionnement par type de forme ────────────────────────

// Retourne les poignées fixes pour rectangle (4 coins), ligne et cône (2 bouts).
// Le cercle n'a pas de poignée fixe : son contour entier est draggable (voir isOnCircleEdge).
export function getHandlesForShape(shape) {
  switch (shape.type) {
    case 'rectangle':
      return [
        { id: 'tl', x: shape.x,  y: shape.y  },  // haut-gauche
        { id: 'tr', x: shape.x2, y: shape.y  },  // haut-droite
        { id: 'bl', x: shape.x,  y: shape.y2 },  // bas-gauche
        { id: 'br', x: shape.x2, y: shape.y2 },  // bas-droite
      ];
    case 'line':
      return [
        { id: 'start', x: shape.x,  y: shape.y  },
        { id: 'end',   x: shape.x2, y: shape.y2 },
      ];
    case 'cone':
      return [
        { id: 'origin', x: shape.x,  y: shape.y  },
        { id: 'tip',    x: shape.x2, y: shape.y2 },
      ];
    default: return []; // cercle : pas de poignée fixe
  }
}

// Cercle : vrai si le curseur est à moins de `threshold` px du contour
export function isOnCircleEdge(shape, pos, threshold) {
  const dist = Math.hypot(pos.x - shape.x, pos.y - shape.y);
  const radius = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
  return Math.abs(dist - radius) < threshold;
}

// Retourne la poignée cliquée ou null (cercle → { id:'edge' } si bord touché)
export function getClickedHandle(shape, pos, threshold) {
  if (shape.type === 'circle') {
    return isOnCircleEdge(shape, pos, threshold) ? { id: 'edge' } : null;
  }
  const handles = getHandlesForShape(shape);
  return handles.find(h => {
    const dx = pos.x - h.x, dy = pos.y - h.y;
    return dx * dx + dy * dy <= threshold * threshold;
  }) || null;
}

// ─── Test de sélection d'une forme de sort ──────────────────────────────────
export function hitTestShape(shape, pos, threshold) {
  const { type, x, y, x2, y2, filled, width } = shape;
  const px = pos.x, py = pos.y;
  switch (type) {
    case 'circle': {
      const r = Math.hypot(x2 - x, y2 - y);
      const d = Math.hypot(px - x, py - y);
      return filled ? d <= r + threshold : Math.abs(d - r) <= threshold + (width || 2) / 2;
    }
    case 'rectangle': {
      const t = threshold;
      return px >= Math.min(x, x2) - t && px <= Math.max(x, x2) + t &&
             py >= Math.min(y, y2) - t && py <= Math.max(y, y2) + t;
    }
    case 'line': {
      const dx = x2 - x, dy = y2 - y, len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - x, py - y) <= threshold;
      const tt = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / len2));
      return Math.hypot(px - (x + tt * dx), py - (y + tt * dy)) <= threshold + (width || 2);
    }
    case 'cone': {
      const angle = Math.atan2(y2 - y, x2 - x);
      const len = Math.hypot(x2 - x, y2 - y);
      const spread = Math.PI / 6;
      const p1 = { x, y };
      const p2 = { x: x + Math.cos(angle - spread) * len, y: y + Math.sin(angle - spread) * len };
      const p3 = { x: x + Math.cos(angle + spread) * len, y: y + Math.sin(angle + spread) * len };
      const dX = px - p3.x, dY = py - p3.y;
      const dX21 = p3.x - p2.x, dY12 = p2.y - p3.y;
      const D = dY12 * (p1.x - p3.x) + dX21 * (p1.y - p3.y);
      const s = dY12 * dX + dX21 * dY;
      const tt = (p3.y - p1.y) * dX + (p1.x - p3.x) * dY;
      return D < 0 ? s <= 0 && tt <= 0 && s + tt >= D : s >= 0 && tt >= 0 && s + tt <= D;
    }
    default: return false;
  }
}
