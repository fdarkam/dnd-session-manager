import { useCallback } from 'react';
import { CONDITIONS } from '../../../domain/conditions';
import { clamp, userColor, VISION_NORMAL, VISION_ENHANCED } from '../mapConstants';
import { drawShape } from './drawShape';

// ──────────────────────────────────────────────
// drawFrame — reads ONLY refs, never state → safe to call synchronously
// Factory : reçoit les refs partagés (singletons) et retourne un drawFrame mémoïsé
// (identité stable via useCallback []) — l'effet socket n'en dépend qu'une fois.
// ──────────────────────────────────────────────
export function useDrawFrame(refs) {
  const {
    canvasRef, containerRef, cursorCanvasRef, panOffsetRef, zoomRef, gridSizeRef, mapImageRef, isDMRef, fogCellsRef, tokenWorldRef, mapWorldRef, mapImgElemRef, imgXRef, imgYRef, imgScaleRef, toolRef, showGridRef, pathsRef, livePathsRef, currentPathRef, drawColorRef, drawWidthRef, fogColorRef, fogOpacityRef, shapesRef, selectedShapeRef, currentShapeRef, tokensRef, tokenVisualsRef, pingAnimRef, otherCursorsRef, cursorVisualsRef,
  } = refs;

  // Fonction nommée → l'auto-appel requestAnimationFrame(drawFrame) pointe sur sa propre identité.
  const drawFrame = useCallback(function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cont = containerRef.current;
    if (cont && (canvas.width !== cont.clientWidth || canvas.height !== cont.clientHeight)) {
      canvas.width = cont.clientWidth; canvas.height = cont.clientHeight;
    }
    if (!canvas.width || !canvas.height) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pan = panOffsetRef.current;
    const z = zoomRef.current;
    const gs = gridSizeRef.current;
    const img = mapImageRef.current;
    const dm = isDMRef.current;
    const fc = fogCellsRef.current;

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(z, z);
    const W = canvas.width / z, H = canvas.height / z, wx0 = -pan.x / z, wy0 = -pan.y / z;

    // Sync overlay divs avec le canvas (pan + zoom) — même transform pour map et tokens
    const overlayTfm = `translate(${pan.x}px,${pan.y}px) scale(${z})`;
    if (tokenWorldRef.current) tokenWorldRef.current.style.transform = overlayTfm;
    if (mapWorldRef.current) mapWorldRef.current.style.transform = overlayTfm;

    // Canvas fond transparent — le fond #1c2033 vient du CSS container
    // La map image est rendue comme <img> HTML dans mapWorldRef (animation GIF native)
    if (img && mapImgElemRef.current) {
      const iw = img.naturalWidth * imgScaleRef.current;
      const ih = img.naturalHeight * imgScaleRef.current;
      mapImgElemRef.current.style.left = `${imgXRef.current}px`;
      mapImgElemRef.current.style.top = `${imgYRef.current}px`;
      mapImgElemRef.current.style.width = `${iw}px`;
      mapImgElemRef.current.style.height = `${ih}px`;
      if (dm && toolRef.current === 'map-edit') {
        const ix = imgXRef.current, iy = imgYRef.current;
        ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 3 / z]);
        ctx.strokeRect(ix, iy, iw, ih); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(96,165,250,0.18)'; ctx.fillRect(ix + 2 / z, iy + 2 / z, iw - 4 / z, ih - 4 / z);
        [[ix, iy], [ix + iw, iy], [ix + iw, iy + ih], [ix, iy + ih]].forEach(([hx, hy]) => {
          ctx.beginPath(); ctx.arc(hx, hy, 8 / z, 0, Math.PI * 2); ctx.fillStyle = '#60a5fa'; ctx.fill();
        });
      }
    }

    // Grille — toujours dessinée avant le fog ; le fog la recouvrira dans les zones fogées
    if (showGridRef.current) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5 / z;
      const gx0 = Math.floor(wx0 / gs) * gs, gy0 = Math.floor(wy0 / gs) * gs;
      for (let x = gx0; x <= wx0 + W + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, gy0 - gs); ctx.lineTo(x, wy0 + H + gs); ctx.stroke(); }
      for (let y = gy0; y <= wy0 + H + gs; y += gs) { ctx.beginPath(); ctx.moveTo(gx0 - gs, y); ctx.lineTo(wx0 + W + gs, y); ctx.stroke(); }
    }

    // Saved drawings
    pathsRef.current.forEach(path => {
      if (!path.points || path.points.length < 2) return;
      ctx.strokeStyle = path.color || '#ef4444'; ctx.lineWidth = (path.width || 2) / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    });

    // Live paths (other users drawing right now)
    Object.values(livePathsRef.current).forEach(lp => {
      if (!lp.points || lp.points.length < 2) return;
      ctx.strokeStyle = lp.color || '#ef4444'; ctx.lineWidth = (lp.width || 2) / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(lp.points[0].x, lp.points[0].y);
      lp.points.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    });

    // Current in-progress path (local user)
    const cp = currentPathRef.current;
    if (cp.length > 1) {
      ctx.strokeStyle = drawColorRef.current; ctx.lineWidth = drawWidthRef.current / z;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(cp[0].x, cp[0].y); cp.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
    }

    // Anneaux et handles de sélection → rendu en CSS (box-shadow) dans le token overlay HTML
    // pour éviter qu'ils soient cachés sous les divs HTML à z-index supérieur

    // ─── Fog simplifié : 2 états uniquement — fogCellsRef (80%) ou rien ─────
    // Path2D fusionne toutes les cellules adjacentes en un seul tracé avant ctx.fill(),
    // ce qui évite les légères variations d'opacité entre cellules qui créaient un effet de quadrillage.
    if (dm) {
      // MJ : fog semi-transparent (voit toujours tout) + cercles de vision debug
      if (fc.size > 0) {
        const hex = fogColorRef.current.replace('#', '');
        const fr = parseInt(hex.slice(0, 2), 16), fg = parseInt(hex.slice(2, 4), 16), fb = parseInt(hex.slice(4, 6), 16);
        // Construire un Path2D unique : cellules fusionnées, limitées aux bounds de l'image
        const fogPath = new Path2D();
        const fImg = mapImageRef.current;
        const fLeft   = fImg ? imgXRef.current : -Infinity;
        const fRight  = fImg ? imgXRef.current + fImg.naturalWidth  * imgScaleRef.current : Infinity;
        const fTop    = fImg ? imgYRef.current : -Infinity;
        const fBottom = fImg ? imgYRef.current + fImg.naturalHeight * imgScaleRef.current : Infinity;
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          const px = cx * gs, py = cy * gs;
          // Exclure les cellules hors bounds de la map (ne peuvent pas exister mais sécurité défensive)
          if (px + gs > fLeft && px < fRight && py + gs > fTop && py < fBottom)
            fogPath.rect(px, py, gs, gs);
        });
        // Un seul fill() = opacité uniforme, pas de bordures entre cellules adjacentes
        ctx.fillStyle = `rgba(${fr},${fg},${fb},${Math.min(fogOpacityRef.current, 0.65)})`;
        ctx.fill(fogPath);
      }
      // Cercles de vision des tokens joueurs — aide le MJ à visualiser les zones révélées
      if (gs > 0) {
        tokensRef.current.forEach(tok => {
          if (tok.hidden || tok.type === 'enemy') return;
          const vr = (tok.nightVision ? VISION_ENHANCED : VISION_NORMAL) * gs;
          // Position interpolée (lerp) plutôt que le snapshot socket → cercle fluide pendant un déplacement distant
          const vis = tokenVisualsRef.current[tok.id];
          const tx = vis?.x ?? tok.x, ty = vis?.y ?? tok.y;
          ctx.beginPath(); ctx.arc(tx, ty, vr, 0, Math.PI * 2);
          ctx.strokeStyle = tok.nightVision ? 'rgba(160,80,255,0.55)' : 'rgba(255,220,80,0.45)';
          ctx.lineWidth = 1.5 / z; ctx.setLineDash([5 / z, 4 / z]); ctx.stroke(); ctx.setLineDash([]);
        });
      }
    } else if (gs > 0 && fc.size > 0) {
      // Joueurs : fog opaque à 80%, limité aux bounds de l'image de la map
      // Path2D unique = un seul ctx.fill() → pas d'effet grille entre cellules adjacentes
      const fogPath = new Path2D();
      const img = mapImageRef.current;
      if (img) {
        const imgLeft   = imgXRef.current;
        const imgTop    = imgYRef.current;
        const imgRight  = imgLeft + img.naturalWidth  * imgScaleRef.current;
        const imgBottom = imgTop  + img.naturalHeight * imgScaleRef.current;
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          const px = cx * gs, py = cy * gs;
          // Inclure uniquement les cellules dans les bounds de l'image
          if (px + gs > imgLeft && px < imgRight && py + gs > imgTop && py < imgBottom)
            fogPath.rect(px, py, gs, gs);
        });
      } else {
        fc.forEach(key => {
          const [cx, cy] = key.split(',').map(Number);
          fogPath.rect(cx * gs, cy * gs, gs, gs);
        });
      }
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fill(fogPath);
    }

    // ─── Dégradé aux bords du rayon de vision (joueurs uniquement) ──────────
    // Adoucit la transition franche entre zone révélée et fog en superposant
    // un voile sombre de 0% (cœur) à 30% opacité (bord) sur chaque rayon joueur.
    if (!dm && gs > 0) {
      tokensRef.current.forEach(tok => {
        if (tok.hidden || tok.visionRadius === 0) return;
        const vr = (tok.visionRadius === 'enhanced' || (tok.visionRadius === undefined && tok.nightVision))
          ? VISION_ENHANCED * gs
          : VISION_NORMAL * gs;
        const vis = tokenVisualsRef.current[tok.id];
        const tx = vis?.x ?? tok.x, ty = vis?.y ?? tok.y;
        const grad = ctx.createRadialGradient(tx, ty, vr * 0.6, tx, ty, vr);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.3)');
        ctx.beginPath();
        ctx.arc(tx, ty, vr, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      });
    }

    // ─── Formes de sorts ─────────────────────────────────────────────────────
    // Dessinées après le fog — toujours visibles (zones de sorts intentionnellement placées)
    shapesRef.current.forEach(s => drawShape(ctx, z, s, s.id === selectedShapeRef.current?.id));
    if (currentShapeRef.current) drawShape(ctx, z, currentShapeRef.current, false);

    // ─── Conditions des tokens ────────────────────────────────────────────────
    // Icônes de conditions en arc de cercle sous chaque token visible
    tokensRef.current.forEach(tok => {
      if (!tok.conditions?.length) return;
      if (!dm && tok.hidden) return;
      if (!dm && gs > 0) {
        const cellKey = `${Math.floor(tok.x / gs)},${Math.floor(tok.y / gs)}`;
        if (fc.has(cellKey)) return;
      }
      const conds = tok.conditions.map(id => CONDITIONS.find(c => c.id === id)).filter(Boolean);
      if (!conds.length) return;
      const vis = tokenVisualsRef.current[tok.id];
      const tx = vis?.x ?? tok.x, ty = vis?.y ?? tok.y;
      const r = clamp(tok.radius || 22, 10, 120);
      const iconR = 7 / z; // rayon icône = 7px écran
      const startAngle = Math.PI * 0.2, endAngle = Math.PI * 0.8;
      conds.forEach((cond, i) => {
        const angle = conds.length === 1
          ? Math.PI * 0.5
          : startAngle + (endAngle - startAngle) * (i / (conds.length - 1));
        const cx = tx + Math.cos(angle) * (r + iconR * 2.2);
        const cy = ty + Math.sin(angle) * (r + iconR * 2.2);
        ctx.beginPath(); ctx.arc(cx, cy, iconR, 0, Math.PI * 2);
        ctx.fillStyle = cond.color; ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.5 / z; ctx.stroke();
        ctx.font = `${11 / z}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cond.emoji, cx, cy);
      });
    });

    // Ping animations — ease-out with 3 rings + impact dot (avant les curseurs)
    const now = Date.now();
    pingAnimRef.current = pingAnimRef.current.filter(p => now - p.ts < 2000);
    pingAnimRef.current.forEach(p => {
      const age = (now - p.ts) / 2000;
      const ease = 1 - Math.pow(1 - age, 2); // ease-out
      // Outer ring
      ctx.strokeStyle = `rgba(250,204,21,${(1 - age) * 0.6})`; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (22 + ease * 65) / z, 0, Math.PI * 2); ctx.stroke();
      // Middle ring
      ctx.strokeStyle = `rgba(250,204,21,${(1 - age) * 0.85})`; ctx.lineWidth = 3 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (12 + ease * 38) / z, 0, Math.PI * 2); ctx.stroke();
      // Inner ring
      ctx.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.7})`; ctx.lineWidth = 1.5 / z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (6 + ease * 18) / z, 0, Math.PI * 2); ctx.stroke();
      // Impact dot (first 25% of animation)
      if (age < 0.25) { const ia = age / 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, (7 * (1 - ia)) / z, 0, Math.PI * 2); ctx.fillStyle = `rgba(250,204,21,${1 - ia})`; ctx.fill(); }
    });
    if (pingAnimRef.current.length > 0) requestAnimationFrame(drawFrame);

    ctx.restore();

    // Curseurs — dessinés sur un canvas dédié (cursorCanvasRef) positionné APRÈS les tokens dans le DOM.
    // Ce canvas a un z-index supérieur aux tokens HTML : les curseurs apparaissent toujours au-dessus.
    // Dessiner les curseurs sur le canvas principal ne fonctionnerait pas car les divs token HTML
    // sont dans une couche DOM supérieure, indépendamment de l'ordre dans drawFrame().
    const cc = cursorCanvasRef.current;
    if (cc) {
      if (cc.width !== canvas.width) cc.width = canvas.width;
      if (cc.height !== canvas.height) cc.height = canvas.height;
      const cCtx = cc.getContext('2d');
      cCtx.clearRect(0, 0, cc.width, cc.height);
      cCtx.save();
      cCtx.translate(pan.x, pan.y);
      cCtx.scale(z, z);
      Object.values(otherCursorsRef.current).forEach(c => {
        const vis = cursorVisualsRef.current[c.userId];
        const cx = vis?.x ?? c.x, cy = vis?.y ?? c.y;
        // Curseur du MJ invisible pour les joueurs — les joueurs ne savent pas où regarde le MJ
        if (!dm && c.isDM) return;
        // Curseurs cachés dans le fog pour les joueurs
        if (!dm) {
          const cellKey = `${Math.floor(cx / gs)},${Math.floor(cy / gs)}`;
          if (fc.has(cellKey)) return;
        }
        const col = userColor(c.userId);
        cCtx.fillStyle = col;
        cCtx.beginPath(); cCtx.moveTo(cx, cy); cCtx.lineTo(cx + 12 / z, cy + 4 / z); cCtx.lineTo(cx + 4 / z, cy + 12 / z); cCtx.closePath(); cCtx.fill();
        cCtx.strokeStyle = 'rgba(0,0,0,0.5)'; cCtx.lineWidth = 0.5 / z; cCtx.stroke();
        cCtx.fillStyle = col; cCtx.font = `bold ${9 / z}px Inter,sans-serif`; cCtx.textAlign = 'left'; cCtx.textBaseline = 'top';
        cCtx.fillText(c.username, cx + 14 / z, cy + 4 / z);
      });
      cCtx.restore();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- deps vides intentionnelles : toutes les données viennent des refs

  return drawFrame;
}
