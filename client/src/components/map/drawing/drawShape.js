import { getHandlesForShape } from '../geometry';

// ─── Rendu d'une forme de sort isolé ─────────────────────────────
// Dessinée après le fog — toujours visible (zones de sorts intentionnellement placées)
export function drawShape(ctx, z, shape, isSelected) {
  if (shape.x2 === undefined || shape.y2 === undefined) return;
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 0.5;
  ctx.strokeStyle = shape.color || '#e74c3c';
  ctx.lineWidth = (shape.width || 2) / z;
  ctx.fillStyle = shape.color || '#e74c3c';
  ctx.beginPath();
  switch (shape.type) {
    case 'circle': {
      const radius = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
      ctx.arc(shape.x, shape.y, radius, 0, Math.PI * 2);
      if (shape.filled) ctx.fill(); ctx.stroke(); break;
    }
    case 'rectangle':
      ctx.rect(shape.x, shape.y, shape.x2 - shape.x, shape.y2 - shape.y);
      if (shape.filled) ctx.fill(); ctx.stroke(); break;
    case 'line':
      ctx.moveTo(shape.x, shape.y); ctx.lineTo(shape.x2, shape.y2); ctx.stroke(); break;
    case 'cone': {
      const angle = Math.atan2(shape.y2 - shape.y, shape.x2 - shape.x);
      const length = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
      const spread = Math.PI / 6;
      ctx.moveTo(shape.x, shape.y);
      ctx.lineTo(shape.x + Math.cos(angle - spread) * length, shape.y + Math.sin(angle - spread) * length);
      ctx.lineTo(shape.x + Math.cos(angle + spread) * length, shape.y + Math.sin(angle + spread) * length);
      ctx.closePath();
      if (shape.filled) ctx.fill(); ctx.stroke(); break;
    }
  }
  // Fix 2 — contour pointillé jaune pour la forme sélectionnée
  if (isSelected) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([6 / z, 3 / z]);
    ctx.beginPath();
    switch (shape.type) {
      case 'circle': {
        const r = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
        ctx.arc(shape.x, shape.y, r, 0, Math.PI * 2); ctx.stroke(); break;
      }
      case 'rectangle':
        ctx.rect(shape.x, shape.y, shape.x2 - shape.x, shape.y2 - shape.y); ctx.stroke(); break;
      case 'line':
        ctx.moveTo(shape.x, shape.y); ctx.lineTo(shape.x2, shape.y2); ctx.stroke(); break;
      case 'cone': {
        const angle = Math.atan2(shape.y2 - shape.y, shape.x2 - shape.x);
        const length = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
        const spread = Math.PI / 6;
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(shape.x + Math.cos(angle - spread) * length, shape.y + Math.sin(angle - spread) * length);
        ctx.lineTo(shape.x + Math.cos(angle + spread) * length, shape.y + Math.sin(angle + spread) * length);
        ctx.closePath(); ctx.stroke(); break;
      }
    }
    ctx.setLineDash([]);
    // Poignées de resize — cercles blancs sur chaque point de contrôle
    const handles = getHandlesForShape(shape);
    handles.forEach(h => {
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'white';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1 / z;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 5 / z, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
    // Cercle — anneau pointillé blanc sur le contour pour signaler qu'il est draggable
    if (shape.type === 'circle') {
      const r = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1 / z;
      ctx.setLineDash([4 / z, 4 / z]);
      ctx.beginPath();
      ctx.arc(shape.x, shape.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  // nom de la forme affiché sous son centre
  if (shape.name) {
    let nameX, nameY;
    switch (shape.type) {
      case 'circle': {
        const r = Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y);
        nameX = shape.x; nameY = shape.y + r + 14 / z; break;
      }
      case 'rectangle':
        nameX = (shape.x + shape.x2) / 2; nameY = Math.max(shape.y, shape.y2) + 14 / z; break;
      case 'line':
      case 'cone':
      default:
        nameX = (shape.x + shape.x2) / 2; nameY = Math.max(shape.y, shape.y2) + 14 / z; break;
    }
    ctx.globalAlpha = 1;
    ctx.font = `bold ${12 / z}px sans-serif`;
    ctx.fillStyle = shape.color || '#e74c3c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(shape.name, nameX, nameY);
  }
  ctx.restore();
}
