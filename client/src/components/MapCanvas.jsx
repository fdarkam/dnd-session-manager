/**
 * MapCanvas — Virtual Tabletop map
 *
 * Real-time architecture:
 *  - Token drag   : emitted every 16ms (live=true, no DB write) → interpolated on receive
 *  - Token drop   : emitted once (live=false, DB write) → snap to final position
 *  - Drawing      : each new point emitted every 16ms (no DB) → others see stroke growing
 *  - Drawing end  : full path emitted once (DB write) + finalize signal clears live preview
 *  - Fog / misc   : emitted on mouseUp
 *
 * All mutable draw data lives in refs so drawFrame() can be called synchronously
 * without waiting for React state reconciliation.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';
const VITE_API = import.meta.env.VITE_API_URL;
import DiceRoller from './DiceRoller';
import CombatTracker from './CombatTracker';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const CURSOR_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399'];
const userColor = (id) => CURSOR_COLORS[Math.abs((id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % CURSOR_COLORS.length];

// ─── Floating resizable panel ────────────────────────────────────────────────
function FloatingPanel({ title, defaultPos, defaultSize, onClose, children }) {
  const [pos, setPos] = useState(defaultPos);
  const [size, setSize] = useState(defaultSize || { w: 320, h: 480 });
  const drag = useRef(false);
  const ori = useRef({});

  const startDrag = (e) => {
    if (e.button !== 0) return;
    drag.current = true;
    ori.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const mv = (ev) => { if (!drag.current) return; setPos({ x: ori.current.px + ev.clientX - ori.current.mx, y: ori.current.py + ev.clientY - ori.current.my }); };
    const up = () => { drag.current = false; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault();
  };

  const startResize = (corner) => (e) => {
    ori.current = { mx: e.clientX, my: e.clientY, w: size.w, h: size.h, px: pos.x };
    const mv = (ev) => {
      const dx = ev.clientX - ori.current.mx, dy = ev.clientY - ori.current.my;
      if (corner === 's') setSize(s => ({ ...s, h: Math.max(180, ori.current.h + dy) }));
      else if (corner === 'se') setSize({ w: Math.max(240, ori.current.w + dx), h: Math.max(180, ori.current.h + dy) });
      else if (corner === 'sw') { setSize({ w: Math.max(240, ori.current.w - dx), h: Math.max(180, ori.current.h + dy) }); setPos(p => ({ ...p, x: ori.current.px + Math.min(dx, ori.current.w - 240) })); }
    };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    e.preventDefault(); e.stopPropagation();
  };

  return (
    <div style={{ position: 'absolute', left: pos.x, top: pos.y, width: size.w, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', zIndex: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div onMouseDown={startDrag} style={{ cursor: 'grab', padding: '7px 12px', background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, userSelect: 'none' }}>
        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent-primary)', fontFamily: 'var(--font-heading)' }}>{title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '0 2px' }}>✕</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1, height: size.h - 36, padding: '8px' }}>{children}</div>
      <div onMouseDown={startResize('s')} style={{ position: 'absolute', bottom: 0, left: 12, right: 12, height: 6, cursor: 's-resize' }} />
      <div onMouseDown={startResize('se')} style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, cursor: 'se-resize' }} />
      <div onMouseDown={startResize('sw')} style={{ position: 'absolute', bottom: 0, left: 0, width: 14, height: 14, cursor: 'sw-resize' }} />
    </div>
  );
}

// ─── Token edit panel ─────────────────────────────────────────────────────────
function TokenEditPanel({ token, onUpdate, onDelete, onClose }) {
  const { token: authToken } = useAuth();
  const [name, setName] = useState(token.name || '');
  const [color, setColor] = useState(token.color || '#c9a84c');
  const [borderColor, setBorderColor] = useState(token.borderColor || '#ffffff');
  const [radius, setRadius] = useState(token.radius || 22);
  const [image, setImage] = useState(token.image || null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  useEffect(() => { setName(token.name||''); setColor(token.color||'#c9a84c'); setBorderColor(token.borderColor||'#ffffff'); setRadius(token.radius||22); setImage(token.image||null); }, [token.id]);

  const handleFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('image', f);
      const res = await fetch(`${API}/maps/token-image`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd });
      if (res.ok) { const data = await res.json(); setImage(`${VITE_API}${data.path}`); }
    } catch { /* ignore upload errors */ }
    setUploading(false);
  };
  const apply = () => onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 80), image });

  return (
    <div style={{ position: 'absolute', right: 8, top: 8, width: 215, background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)', zIndex: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.7)', padding: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}>Modifier token</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Nom" style={{ fontSize:'0.82rem', padding:'4px 7px' }} onKeyDown={e=>e.key==='Enter'&&apply()} />
        <div style={{ display:'flex', gap:'5px', alignItems:'center', fontSize:'0.78rem' }}>
          <label style={{ color:'var(--text-muted)' }}>Fond</label>
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{ width:'26px',height:'22px',padding:0,border:'none',cursor:'pointer' }} />
          <label style={{ color:'var(--text-muted)' }}>Bord.</label>
          <input type="color" value={borderColor} onChange={e=>setBorderColor(e.target.value)} style={{ width:'26px',height:'22px',padding:0,border:'none',cursor:'pointer' }} />
        </div>
        <div style={{ display:'flex', gap:'5px', alignItems:'center', fontSize:'0.78rem' }}>
          <label style={{ color:'var(--text-muted)',flexShrink:0 }}>Rayon px</label>
          <input type="number" value={radius} onChange={e=>setRadius(Number(e.target.value))} min={10} max={80} style={{ width:'55px',padding:'3px 5px',fontSize:'0.8rem' }} />
        </div>
        {image && <div style={{ display:'flex',alignItems:'center',gap:'5px' }}><img src={image} alt="" style={{ width:30,height:30,borderRadius:'50%',objectFit:'cover' }} /><button className="btn btn-sm btn-secondary" style={{ fontSize:'0.72rem' }} onClick={()=>setImage(null)}>✕</button></div>}
        <button className="btn btn-secondary btn-sm" onClick={()=>fileRef.current.click()} disabled={uploading} style={{ fontSize:'0.78rem' }}>🖼️ {uploading?'...':(image?'Changer':'Upload image')}</button>
        <input ref={fileRef} type="file" accept="image/*,.jfif" onChange={handleFile} style={{ display:'none' }} />
        <div style={{ display:'flex', gap:'5px', marginTop:'2px' }}>
          <button className="btn btn-primary btn-sm" onClick={apply} style={{ flex:1, fontSize:'0.8rem' }}>Appliquer</button>
          <button className="btn btn-danger btn-sm" onClick={onDelete} title="Supprimer (Suppr)">🗑️</button>
        </div>
        <span style={{ fontSize:'0.66rem', color:'var(--text-muted)', textAlign:'center' }}>Suppr pour effacer • Glisser coin pour redimensionner</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function MapCanvas({ sessionId, isDM }) {
  const socket = useSocket();
  const { token, user } = useAuth();
  const canvasRef   = useRef(null);
  const containerRef = useRef(null);

  // ── Operation flags ──
  const fogPainting    = useRef(false);
  const eraserActive   = useRef(false);
  const resizingToken  = useRef(null);
  const dragMoved      = useRef(false);
  const lastDragEmit   = useRef(0);
  const lastCursorEmit = useRef(0);
  const lastDrawEmit   = useRef(0);
  const lastFogEmit    = useRef(0);
  const panStartRef    = useRef({ x: 0, y: 0 }); // avoids re-renders during panning
  const pingAnimRef    = useRef([]);
  const lerpAnimRef    = useRef(null);
  const tokenLastClickRef = useRef({ id: null, time: 0 });
  const fetchMapsRef   = useRef(null);
  // Sync flags — updated synchronously so mousemove handlers are never stale
  const isDrawingRef   = useRef(false);
  const isPanningRef   = useRef(false);
  const isDraggingRef  = useRef(null);  // stores the token object being dragged

  // ── Draw data refs (always fresh for synchronous drawFrame calls) ──
  const tokensRef        = useRef([]);
  const tokenVisualsRef  = useRef({});   // interpolated display positions per token id
  const tokenLerpsRef    = useRef({});   // active lerp jobs { fromX,fromY,toX,toY,startTime,duration }
  const cursorVisualsRef = useRef({});   // interpolated cursor positions { userId: {x,y} }
  const cursorLerpsRef   = useRef({});   // cursor lerp jobs (same shape as tokenLerpsRef)
  const pathsRef         = useRef([]);
  const livePathsRef     = useRef({});   // other users' in-progress strokes { pathId: {color,width,points[]} }
  const currentPathRef   = useRef([]);
  const currentPathIdRef = useRef(null); // id shared with finalized path
  const selectedTokenRef = useRef(null);
  const panOffsetRef     = useRef({ x: 0, y: 0 });
  const zoomRef          = useRef(1);
  const mapImageRef      = useRef(null);
  const imgXRef          = useRef(0);
  const imgYRef          = useRef(0);
  const imgScaleRef      = useRef(1);
  const gridSizeRef      = useRef(40);
  const drawColorRef     = useRef('#ef4444');
  const drawWidthRef     = useRef(2);
  const fogColorRef      = useRef('#000000');
  const fogOpacityRef    = useRef(0.85);
  const fogCellsRef      = useRef(new Set());
  const fogBrushPxRef    = useRef(40);
  const isDMRef          = useRef(isDM);
  const activeMapRef     = useRef(null);
  const otherCursorsRef  = useRef({});
  const snapToGridRef    = useRef(false);
  const toolRef          = useRef('move');
  const imgCacheRef      = useRef({});

  // ── React state (drives re-render / UI only) ──
  const [maps, setMaps]           = useState([]);
  const [activeMap, setActiveMap] = useState(null);
  const [mapImage, setMapImage]   = useState(null);
  const [imgX, setImgX]           = useState(0);
  const [imgY, setImgY]           = useState(0);
  const [imgScale, setImgScale]   = useState(1);
  const [tokens, setTokens]       = useState([]);
  const [paths, setPaths]         = useState([]);
  const [fogCells, setFogCells]   = useState(new Set());
  const [tool, setTool]           = useState('move');
  const [gridSize, setGridSize]   = useState(40);
  const [drawColor, setDrawColor] = useState('#ef4444');
  const [drawWidth, setDrawWidth] = useState(2);
  const [eraserSize, setEraserSize] = useState(20);
  const [fogBrushPx, setFogBrushPx] = useState(40);
  const [fogColor, setFogColor]   = useState('#000000');
  const [fogOpacity, setFogOpacity] = useState(0.85);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [drawing, setDrawing]     = useState(false);
  const [dragging, setDragging]   = useState(null);
  const [editingMapImg, setEditingMapImg] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null); // { type: 'token'|'map-image', id? }
  const [zoom, setZoom]           = useState(1);
  const [selectedToken, setSelectedToken] = useState(null);
  const [showTokenEdit, setShowTokenEdit] = useState(false);
  const [showDice, setShowDice]   = useState(false);
  const [showCombat, setShowCombat] = useState(false);
  const [newTokenName, setNewTokenName]   = useState('');
  const [newTokenColor, setNewTokenColor] = useState('#c9a84c');
  const [newTokenBorderColor, setNewTokenBorderColor] = useState('#ffffff');
  const [newTokenRadius, setNewTokenRadius] = useState(22);
  const newTokenFileRef = useRef();
  const [newTokenImage, setNewTokenImage] = useState(null);

  // ── Keep refs in sync with state ──
  useEffect(() => { if (!isDraggingRef.current) tokensRef.current = tokens; }, [tokens]);
  useEffect(() => { pathsRef.current = paths; }, [paths]);
  useEffect(() => { panOffsetRef.current = panOffset; }, [panOffset]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { mapImageRef.current = mapImage; }, [mapImage]);
  useEffect(() => { imgXRef.current = imgX; imgYRef.current = imgY; imgScaleRef.current = imgScale; }, [imgX, imgY, imgScale]);
  useEffect(() => { gridSizeRef.current = gridSize; }, [gridSize]);
  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { drawWidthRef.current = drawWidth; }, [drawWidth]);
  useEffect(() => { fogColorRef.current = fogColor; }, [fogColor]);
  useEffect(() => { fogOpacityRef.current = fogOpacity; }, [fogOpacity]);
  useEffect(() => { fogBrushPxRef.current = fogBrushPx; }, [fogBrushPx]);
  useEffect(() => { fogCellsRef.current = fogCells; }, [fogCells]);
  useEffect(() => { isDMRef.current = isDM; }, [isDM]);
  useEffect(() => { activeMapRef.current = activeMap; }, [activeMap]);
  useEffect(() => { snapToGridRef.current = snapToGrid; }, [snapToGrid]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { selectedTokenRef.current = selectedToken; }, [selectedToken]);

  // ─────────────────────────────────────────────────────────────────────────
  // drawFrame — reads ONLY refs, never state → safe to call synchronously
  // ─────────────────────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx   = canvas.getContext('2d');
    const cont  = containerRef.current;
    if (cont && (canvas.width !== cont.clientWidth || canvas.height !== cont.clientHeight)) {
      canvas.width = cont.clientWidth; canvas.height = cont.clientHeight;
    }
    if (!canvas.width || !canvas.height) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pan = panOffsetRef.current;
    const z   = zoomRef.current;
    const gs  = gridSizeRef.current;
    const img = mapImageRef.current;
    const dm  = isDMRef.current;
    const fc  = fogCellsRef.current;

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(z, z);
    const W = canvas.width/z, H = canvas.height/z, wx0 = -pan.x/z, wy0 = -pan.y/z;

    // Background
    ctx.fillStyle = '#1c2033';
    ctx.fillRect(wx0-2, wy0-2, W+4, H+4);

    // Map image + optional edit overlay
    if (img) {
      const iw = img.naturalWidth * imgScaleRef.current;
      const ih = img.naturalHeight * imgScaleRef.current;
      ctx.drawImage(img, imgXRef.current, imgYRef.current, iw, ih);
      if (dm && toolRef.current === 'map-edit') {
        const ix = imgXRef.current, iy = imgYRef.current;
        ctx.strokeStyle='#60a5fa'; ctx.lineWidth=2/z; ctx.setLineDash([6/z,3/z]);
        ctx.strokeRect(ix,iy,iw,ih); ctx.setLineDash([]);
        ctx.fillStyle='rgba(96,165,250,0.18)'; ctx.fillRect(ix+2/z,iy+2/z,iw-4/z,ih-4/z);
        [[ix,iy],[ix+iw,iy],[ix+iw,iy+ih],[ix,iy+ih]].forEach(([hx,hy]) => {
          ctx.beginPath(); ctx.arc(hx,hy,8/z,0,Math.PI*2); ctx.fillStyle='#60a5fa'; ctx.fill();
        });
      }
    }

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 0.5/z;
    const gx0 = Math.floor(wx0/gs)*gs, gy0 = Math.floor(wy0/gs)*gs;
    for (let x=gx0; x<=wx0+W+gs; x+=gs) { ctx.beginPath(); ctx.moveTo(x,gy0-gs); ctx.lineTo(x,wy0+H+gs); ctx.stroke(); }
    for (let y=gy0; y<=wy0+H+gs; y+=gs) { ctx.beginPath(); ctx.moveTo(gx0-gs,y); ctx.lineTo(wx0+W+gs,y); ctx.stroke(); }

    // Saved drawings
    pathsRef.current.forEach(path => {
      if (!path.points||path.points.length<2) return;
      ctx.strokeStyle=path.color||'#ef4444'; ctx.lineWidth=(path.width||2)/z;
      ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(path.points[0].x,path.points[0].y);
      path.points.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
    });

    // Live paths (other users drawing right now)
    Object.values(livePathsRef.current).forEach(lp => {
      if (!lp.points||lp.points.length<2) return;
      ctx.strokeStyle=lp.color||'#ef4444'; ctx.lineWidth=(lp.width||2)/z;
      ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(lp.points[0].x,lp.points[0].y);
      lp.points.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
    });

    // Current in-progress path (local user)
    const cp = currentPathRef.current;
    if (cp.length>1) {
      ctx.strokeStyle=drawColorRef.current; ctx.lineWidth=drawWidthRef.current/z;
      ctx.lineCap='round'; ctx.lineJoin='round';
      ctx.beginPath(); ctx.moveTo(cp[0].x,cp[0].y); cp.forEach(p=>ctx.lineTo(p.x,p.y)); ctx.stroke();
    }

    // Tokens — use interpolated visual position when available
    tokensRef.current.forEach(t => {
      const vis = tokenVisualsRef.current[t.id];
      const vx  = vis?.x ?? t.x;
      const vy  = vis?.y ?? t.y;
      const r   = clamp(t.radius||22, 10, 80);
      const sel = selectedTokenRef.current?.id === t.id;

      if (sel) {
        ctx.beginPath(); ctx.arc(vx,vy,r+6/z,0,Math.PI*2);
        ctx.strokeStyle='rgba(250,204,21,0.35)'; ctx.lineWidth=6/z; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(vx,vy,r+2/z,0,Math.PI*2);
      ctx.strokeStyle=sel?'#facc15':(t.borderColor||'#fff'); ctx.lineWidth=(sel?3:2)/z; ctx.stroke();

      ctx.save(); ctx.beginPath(); ctx.arc(vx,vy,r,0,Math.PI*2); ctx.clip();
      if (t.image) {
        const ck = t.id+'_img'; const cache = imgCacheRef.current;
        if (!cache[ck]||cache[ck+'_src']!==t.image) {
          const io=new Image(); io.crossOrigin='anonymous';
          io.onload=()=>{cache[ck]=io;cache[ck+'_src']=t.image;drawFrame();};
          cache[ck]=null; cache[ck+'_src']=t.image; io.src=t.image;
        }
        if (cache[ck]) ctx.drawImage(cache[ck],vx-r,vy-r,r*2,r*2);
        else { ctx.fillStyle=t.color||'#c9a84c'; ctx.fill(); }
      } else { ctx.fillStyle=t.color||'#c9a84c'; ctx.fill(); }
      ctx.restore();

      // Full name inside — shrink to fit
      const maxW=r*1.7; let fs=Math.max(7,Math.round(r*0.38));
      ctx.font=`bold ${fs}px Inter,sans-serif`;
      while (ctx.measureText(t.name||'').width>maxW&&fs>6) { fs--; ctx.font=`bold ${fs}px Inter,sans-serif`; }
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.strokeStyle='rgba(0,0,0,0.65)'; ctx.lineWidth=2.5/z;
      ctx.strokeText(t.name||'',vx,vy); ctx.fillText(t.name||'',vx,vy);

      // Resize handle on selected token
      if (sel) {
        ctx.beginPath(); ctx.arc(vx+r*0.707,vy+r*0.707,5/z,0,Math.PI*2);
        ctx.fillStyle='#facc15'; ctx.fill();
        ctx.strokeStyle='#000'; ctx.lineWidth=1/z; ctx.stroke();
      }
    });

    // Fog cells
    if (fc.size>0) {
      if (dm) {
        const hex=fogColorRef.current.replace('#','');
        const fr=parseInt(hex.slice(0,2),16), fg=parseInt(hex.slice(2,4),16), fb=parseInt(hex.slice(4,6),16);
        ctx.fillStyle=`rgba(${fr},${fg},${fb},${Math.min(fogOpacityRef.current,0.65)})`;
        fc.forEach(key=>{ const [cx,cy]=key.split(',').map(Number); ctx.fillRect(cx*gs,cy*gs,gs,gs); });
      } else {
        // Players: fully opaque, cells slightly expanded to eliminate sub-pixel gaps
        ctx.fillStyle=fogColorRef.current;
        fc.forEach(key=>{ const [cx,cy]=key.split(',').map(Number); ctx.fillRect(cx*gs-0.5,cy*gs-0.5,gs+1,gs+1); });
      }
    }

    // Other players' cursors — lerped positions, hidden in fog for non-DM
    Object.values(otherCursorsRef.current).forEach(c => {
      const vis = cursorVisualsRef.current[c.userId];
      const cx = vis?.x ?? c.x, cy = vis?.y ?? c.y;
      // Players cannot see cursors hidden behind fog
      if (!dm) {
        const cellKey=`${Math.floor(cx/gs)},${Math.floor(cy/gs)}`;
        if (fc.has(cellKey)) return;
      }
      const col=userColor(c.userId);
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+12/z,cy+4/z); ctx.lineTo(cx+4/z,cy+12/z); ctx.closePath(); ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.5/z; ctx.stroke();
      ctx.fillStyle=col; ctx.font=`bold ${9/z}px Inter,sans-serif`; ctx.textAlign='left'; ctx.textBaseline='top';
      ctx.fillText(c.username,cx+14/z,cy+4/z);
    });

    // Ping animations — ease-out with 3 rings + impact dot
    const now=Date.now();
    pingAnimRef.current=pingAnimRef.current.filter(p=>now-p.ts<2000);
    pingAnimRef.current.forEach(p=>{
      const age=(now-p.ts)/2000;
      const ease=1-Math.pow(1-age,2); // ease-out
      // Outer ring
      ctx.strokeStyle=`rgba(250,204,21,${(1-age)*0.6})`; ctx.lineWidth=2/z;
      ctx.beginPath(); ctx.arc(p.x,p.y,(22+ease*65)/z,0,Math.PI*2); ctx.stroke();
      // Middle ring
      ctx.strokeStyle=`rgba(250,204,21,${(1-age)*0.85})`; ctx.lineWidth=3/z;
      ctx.beginPath(); ctx.arc(p.x,p.y,(12+ease*38)/z,0,Math.PI*2); ctx.stroke();
      // Inner ring
      ctx.strokeStyle=`rgba(255,255,255,${(1-age)*0.7})`; ctx.lineWidth=1.5/z;
      ctx.beginPath(); ctx.arc(p.x,p.y,(6+ease*18)/z,0,Math.PI*2); ctx.stroke();
      // Impact dot (first 25% of animation)
      if (age<0.25) { const ia=age/0.25; ctx.beginPath(); ctx.arc(p.x,p.y,(7*(1-ia))/z,0,Math.PI*2); ctx.fillStyle=`rgba(250,204,21,${1-ia})`; ctx.fill(); }
    });
    if (pingAnimRef.current.length>0) requestAnimationFrame(drawFrame);

    ctx.restore();
  }, []); // ← empty deps: all data comes from refs

  // ─── Token interpolation loop ─────────────────────────────────────────────
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
      drawFrame();
      lerpAnimRef.current = active ? requestAnimationFrame(animate) : null;
    };
    lerpAnimRef.current = requestAnimationFrame(animate);
  }, [drawFrame]);

  // ─── ResizeObserver: initial draw when container gets its size ───────────
  useEffect(() => {
    const c = containerRef.current; if (!c) return;
    const obs = new ResizeObserver(() => drawFrame());
    obs.observe(c);
    return () => obs.disconnect();
  }, [drawFrame]);

  // Redraw on state changes
  useEffect(() => { drawFrame(); }, [tokens, paths, panOffset, zoom, mapImage, imgX, imgY, imgScale, fogCells, gridSize, drawColor, drawWidth, fogColor, fogOpacity, tool, drawFrame]);

  // Delete key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key!=='Delete'&&e.key!=='Backspace') return;
      const a=document.activeElement;
      if (a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA')) return;
      // Map-edit mode: Delete clears the background image (with confirmation)
      if (toolRef.current==='map-edit'&&isDMRef.current&&mapImageRef.current) {
        e.preventDefault();
        setPendingDelete({ type: 'map-image' });
        return;
      }
      if (selectedTokenRef.current) {
        e.preventDefault();
        setPendingDelete({ type: 'token', id: selectedTokenRef.current.id, name: selectedTokenRef.current.name });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [socket, sessionId, drawFrame]);

  // ─── Socket listeners ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // Reload map data after socket reconnect (server may have changed while disconnected)
    const hasConnectedRef = { current: socket.connected };
    const onConnect = () => {
      if (hasConnectedRef.current) fetchMapsRef.current?.();
      hasConnectedRef.current = true;
    };
    socket.on('connect', onConnect);

    const onTokenUpdate = ({ mapId, tokens: t, live }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const parsed = typeof t==='string' ? JSON.parse(t) : (t||[]);
      if (live) {
        // Start interpolation toward new positions (smooth movement)
        parsed.forEach(tk => {
          const vis = tokenVisualsRef.current[tk.id];
          tokenLerpsRef.current[tk.id] = { fromX: vis?.x??tk.x, fromY: vis?.y??tk.y, toX: tk.x, toY: tk.y, startTime: Date.now(), duration: 80 };
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
      pathsRef.current=[]; setPaths([]);
    };
    const onMapChanged = ({ map }) => {
      if (!map) return;
      setMaps(prev => prev.map(m => ({ ...m, is_active: m.id===map.id?1:0 })));
      setActiveMap(map); loadFog(map); loadImgTransform(map);
    };
    const onFogUpdate = ({ mapId, fogCells: cells, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const s=new Set(Array.isArray(cells)?cells:[]);
      fogCellsRef.current=s; setFogCells(s);
      if (gs) { gridSizeRef.current=gs; setGridSize(gs); }
    };
    // Live fog preview while DM is painting (no DB write — same as map-drawing-live)
    const onFogLive = ({ mapId, fogCells: cells, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      const s=new Set(Array.isArray(cells)?cells:[]);
      fogCellsRef.current=s; setFogCells(s);
      if (gs) { gridSizeRef.current=gs; setGridSize(gs); }
    };
    const onImageUpdated = ({ mapId, img_x, img_y, img_scale }) => {
      if (mapId !== activeMapRef.current?.id) return;
      setImgX(img_x); setImgY(img_y); setImgScale(img_scale);
    };
    const onMapDeleted = ({ mapId }) => {
      setMaps(prev => { const next=prev.filter(m=>m.id!==mapId); if (activeMapRef.current?.id===mapId) setActiveMap(next[0]||null); return next; });
    };
    const onMapListUpdated = () => { fetchMapsRef.current?.(); };
    const onCursorUpdate = ({ userId, username, x, y }) => {
      const vis = cursorVisualsRef.current[userId] || { x, y };
      cursorLerpsRef.current[userId] = { fromX: vis.x, fromY: vis.y, toX: x, toY: y, startTime: Date.now(), duration: 100 };
      otherCursorsRef.current = { ...otherCursorsRef.current, [userId]: { userId, username, x, y } };
      startLerpAnimation();
    };
    const onPing = ({ x, y }) => {
      pingAnimRef.current = [...pingAnimRef.current, { x, y, ts: Date.now() }];
      drawFrame();
    };
    const onGridSize = ({ mapId, gridSize: gs }) => {
      if (mapId !== activeMapRef.current?.id) return;
      gridSizeRef.current=gs; setGridSize(gs);
    };
    const onMapImageCleared = ({ mapId }) => {
      if (mapId !== activeMapRef.current?.id) return;
      mapImageRef.current=null; setMapImage(null); drawFrame();
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
    socket.on('cursor-update', onCursorUpdate);
    socket.on('map-ping', onPing);
    socket.on('map-grid-size', onGridSize);
    socket.on('map-image-cleared', onMapImageCleared);
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
      socket.off('cursor-update', onCursorUpdate);
      socket.off('map-ping', onPing);
      socket.off('map-grid-size', onGridSize);
      socket.off('map-image-cleared', onMapImageCleared);
    };
  }, [socket, startLerpAnimation, drawFrame]);

  // Load map when active changes
  useEffect(() => {
    if (!activeMap) {
      // All maps deleted — clear canvas to empty grid
      mapImageRef.current=null; setMapImage(null);
      tokensRef.current=[]; setTokens([]);
      pathsRef.current=[]; setPaths([]);
      fogCellsRef.current=new Set(); setFogCells(new Set());
      livePathsRef.current={};
      drawFrame();
      return;
    }
    const io=new Image();
    io.src=`${import.meta.env.VITE_API_URL}${activeMap.image_path}`;
    io.onload=()=>{mapImageRef.current=io;setMapImage(io);};
    io.onerror=()=>{mapImageRef.current=null;setMapImage(null);};
    const toks=typeof activeMap.tokens==='string'?JSON.parse(activeMap.tokens):(activeMap.tokens||[]);
    tokensRef.current=toks; setTokens(toks);
    const pths=typeof activeMap.drawings==='string'?JSON.parse(activeMap.drawings):(activeMap.drawings||[]);
    pathsRef.current=pths; setPaths(pths);
    livePathsRef.current={};
    loadFog(activeMap); loadImgTransform(activeMap);
  }, [activeMap, drawFrame]);

  const loadFog = (map) => {
    try {
      const raw = JSON.parse(map.fog_data || '[]');
      const cells = Array.isArray(raw) ? raw : (raw.cells || []);
      const gs = Array.isArray(raw) ? null : raw.gs;
      const s = new Set(cells);
      fogCellsRef.current = s; setFogCells(s);
      if (gs) { gridSizeRef.current = gs; setGridSize(gs); }
    } catch { fogCellsRef.current = new Set(); setFogCells(new Set()); }
  };
  const loadImgTransform = (map) => {
    const x=map.img_x||0, y=map.img_y||0, s=map.img_scale||1;
    setImgX(x); setImgY(y); setImgScale(s);
  };

  const fetchMaps = useCallback(async () => {
    const res=await fetch(`${API}/maps/session/${sessionId}`,{headers:{Authorization:`Bearer ${token}`}});
    if (res.ok) {
      const data=await res.json(); setMaps(data);
      if (!activeMapRef.current||!data.find(m=>m.id===activeMapRef.current.id)) {
        const a=data.find(m=>m.is_active)||data[0];
        setActiveMap(a||null); // null clears map when all maps deleted
      }
    }
  }, [sessionId, token]);
  fetchMapsRef.current = fetchMaps; // keep ref fresh without adding to socket effect deps
  useEffect(() => { fetchMaps(); }, [fetchMaps]);

  const uploadMap = async (e) => {
    const f=e.target.files[0]; if (!f) return;
    const fd=new FormData(); fd.append('image',f); fd.append('session_id',sessionId); fd.append('name',f.name.replace(/\.[^.]+$/,''));
    const res=await fetch(`${API}/maps`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});
    if (res.ok) {
      fetchMaps();
      if (socket) socket.emit('map-uploaded', { sessionId });
    }
    e.target.value='';
  };
  const deleteCurrentMap = () => {
    if (!activeMapRef.current) return;
    setShowDeleteConfirm(true);
  };
  const confirmDeleteMap = async () => {
    setShowDeleteConfirm(false);
    const mapId = activeMapRef.current?.id;
    if (!mapId) return;
    const res = await fetch(`${API}/maps/${mapId}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});
    if (res.ok) {
      if (socket) socket.emit('map-delete', { sessionId, mapId });
      fetchMaps();
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const getWorldPos = (e) => {
    const rect=canvasRef.current.getBoundingClientRect();
    const pan=panOffsetRef.current, z=zoomRef.current;
    return { x:(e.clientX-rect.left-pan.x)/z, y:(e.clientY-rect.top-pan.y)/z };
  };
  const snapPos = (x, y) => {
    if (!snapToGridRef.current) return {x,y};
    const gs=gridSizeRef.current;
    return { x:Math.round(x/gs)*gs+gs/2, y:Math.round(y/gs)*gs+gs/2 };
  };
  const paintFog = (wx, wy, adding) => {
    const half=fogBrushPxRef.current/2, gs=gridSizeRef.current;
    const cx0=Math.floor((wx-half)/gs), cy0=Math.floor((wy-half)/gs);
    const cx1=Math.floor((wx+half)/gs), cy1=Math.floor((wy+half)/gs);
    const next=new Set(fogCellsRef.current);
    for (let cx=cx0;cx<=cx1;cx++) for (let cy=cy0;cy<=cy1;cy++) adding?next.add(`${cx},${cy}`):next.delete(`${cx},${cy}`);
    fogCellsRef.current=next; setFogCells(next); drawFrame();
  };
  const getMapImgHit = (pos) => {
    const img=mapImageRef.current; if (!img) return null;
    const ix=imgXRef.current, iy=imgYRef.current;
    const iw=img.naturalWidth*imgScaleRef.current, ih=img.naturalHeight*imgScaleRef.current;
    const hs=14/zoomRef.current;
    for (const [type,hx,hy] of [['nw',ix,iy],['ne',ix+iw,iy],['se',ix+iw,iy+ih],['sw',ix,iy+ih]]) {
      const dx=pos.x-hx,dy=pos.y-hy; if (dx*dx+dy*dy<hs*hs) return type;
    }
    if (pos.x>=ix&&pos.x<=ix+iw&&pos.y>=iy&&pos.y<=iy+ih) return 'move';
    return null;
  };
  const emitImgTransform = (x, y, s) => {
    if (!socket||!activeMapRef.current) return;
    socket.emit('map-image-transform',{sessionId,mapId:activeMapRef.current.id,img_x:Math.round(x),img_y:Math.round(y),img_scale:s});
  };

  // ─── Mouse handlers ───────────────────────────────────────────────────────
  const handleMouseDown = (e) => {
    if (e.button===2) {
      const pos=getWorldPos(e);
      if (socket) socket.emit('map-ping',{sessionId,x:pos.x,y:pos.y});
      e.preventDefault(); return;
    }
    const pos=getWorldPos(e);

    if (toolRef.current==='map-edit'&&isDM) {
      const hit=getMapImgHit(pos);
      if (hit) {
        const img=mapImageRef.current;
        const iw=img?img.naturalWidth*imgScaleRef.current:0, ih=img?img.naturalHeight*imgScaleRef.current:0;
        setEditingMapImg({type:hit,startPos:pos,startX:imgXRef.current,startY:imgYRef.current,startW:iw,startH:ih,startScale:imgScaleRef.current,origW:img?.naturalWidth||1});
        return;
      }
    }
    if ((toolRef.current==='fog-add'||toolRef.current==='fog-erase')&&isDM) { fogPainting.current=true; paintFog(pos.x,pos.y,toolRef.current==='fog-add'); return; }
    if (toolRef.current==='erase'&&isDM) {
      eraserActive.current=true;
      const r=eraserSize/zoomRef.current;
      const ids=pathsRef.current.filter(p=>p.points?.some(pt=>{const dx=pt.x-pos.x,dy=pt.y-pos.y;return dx*dx+dy*dy<r*r;})).map(p=>p.id);
      if (ids.length) {
        const next=pathsRef.current.filter(p=>!ids.includes(p.id));
        pathsRef.current=next; setPaths(next); drawFrame();
        if (socket) socket.emit('map-drawing-erase',{sessionId,mapId:activeMapRef.current?.id,erasedIds:ids});
      }
      return;
    }
    if (toolRef.current==='draw') {
      currentPathIdRef.current=`p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      currentPathRef.current=[pos];
      isDrawingRef.current=true;
      setDrawing(true); return;
    }
    if (toolRef.current==='token'&&newTokenName.trim()) {
      const sp=snapPos(pos.x,pos.y);
      const tok={id:`tok_${Date.now()}_${Math.random().toString(36).slice(2)}`,name:newTokenName,color:newTokenColor,borderColor:newTokenBorderColor,radius:clamp(newTokenRadius,10,80),image:newTokenImage,x:sp.x,y:sp.y};
      const upd=[...tokensRef.current,tok]; tokensRef.current=upd; setTokens(upd); drawFrame();
      if (socket) socket.emit('map-token-add',{sessionId,mapId:activeMapRef.current?.id,token:tok,allTokens:upd});
      return;
    }
    if (toolRef.current==='move') {
      const sel=selectedTokenRef.current;
      if (sel) {
        const r=clamp(sel.radius||22,10,80);
        const hx=sel.x+r*0.707, hy=sel.y+r*0.707;
        const dx=pos.x-hx, dy=pos.y-hy;
        if (dx*dx+dy*dy<=(12/zoomRef.current)**2) { resizingToken.current={token:sel}; return; }
      }
      const clicked=tokensRef.current.find(t=>{const r=clamp(t.radius||22,10,80);const dx=t.x-pos.x,dy=t.y-pos.y;return dx*dx+dy*dy<=(r+5)**2;});
      if (clicked) {
        if (selectedTokenRef.current?.id !== clicked.id) setShowTokenEdit(false);
        dragMoved.current=false; isDraggingRef.current=clicked; setDragging(clicked); selectedTokenRef.current=clicked; setSelectedToken(clicked); return;
      }
      setSelectedToken(null); selectedTokenRef.current=null; setShowTokenEdit(false);
      isPanningRef.current=true; setIsPanning(true);
      panStartRef.current={x:e.clientX-panOffsetRef.current.x,y:e.clientY-panOffsetRef.current.y};
    }
  };

  const handleMouseMove = (e) => {
    const pos=getWorldPos(e);
    const now=Date.now();

    // Broadcast cursor position (throttled 100ms)
    if (socket&&now-lastCursorEmit.current>100) {
      lastCursorEmit.current=now;
      socket.emit('cursor-move',{sessionId,x:pos.x,y:pos.y});
    }

    if (editingMapImg) {
      const {type,startPos,startX,startY,startW,startH,origW}=editingMapImg;
      const dx=pos.x-startPos.x, dy=pos.y-startPos.y;
      if (type==='move') { imgXRef.current=startX+dx; imgYRef.current=startY+dy; }
      else {
        let nw=startW, nx=startX, ny=startY;
        if (type==='se') nw=Math.max(50,startW+dx);
        else if (type==='sw') { nw=Math.max(50,startW-dx); nx=startX+(startW-nw); }
        else if (type==='ne') { nw=Math.max(50,startW+dx); }
        else if (type==='nw') { nw=Math.max(50,startW-dx); nx=startX+(startW-nw); }
        const ns=nw/origW;
        const nh=(mapImageRef.current?.naturalHeight||1)*ns;
        if (type==='ne'||type==='nw') ny=startY+startH-nh;
        imgScaleRef.current=ns; imgXRef.current=nx; imgYRef.current=ny;
      }
      drawFrame(); return; // setState deferred to mouseUp → no re-renders during drag
    }
    if (fogPainting.current&&isDM) {
      paintFog(pos.x,pos.y,toolRef.current==='fog-add');
      if (socket&&now-lastFogEmit.current>100) {
        lastFogEmit.current=now;
        socket.emit('map-fog-live',{sessionId,mapId:activeMapRef.current?.id,fogCells:Array.from(fogCellsRef.current),gridSize:gridSizeRef.current});
      }
      return;
    }
    if (eraserActive.current&&isDM) {
      const r=eraserSize/zoomRef.current;
      const ids=pathsRef.current.filter(p=>p.points?.some(pt=>{const dx=pt.x-pos.x,dy=pt.y-pos.y;return dx*dx+dy*dy<r*r;})).map(p=>p.id);
      if (ids.length) {
        const next=pathsRef.current.filter(p=>!ids.includes(p.id));
        pathsRef.current=next; setPaths(next); drawFrame();
        if (socket) socket.emit('map-drawing-erase',{sessionId,mapId:activeMapRef.current?.id,erasedIds:ids});
      }
      return;
    }
    if (resizingToken.current) {
      const t=resizingToken.current.token;
      const newR=clamp(Math.round(Math.sqrt((pos.x-t.x)**2+(pos.y-t.y)**2)),10,80);
      const upd=tokensRef.current.map(tk=>tk.id===t.id?{...tk,radius:newR}:tk);
      tokensRef.current=upd; setTokens(upd);
      const updSel={...(selectedTokenRef.current||t),radius:newR}; selectedTokenRef.current=updSel; setSelectedToken(updSel);
      drawFrame();
      if (socket&&now-lastDragEmit.current>16) { lastDragEmit.current=now; socket.emit('map-token-move',{sessionId,mapId:activeMapRef.current?.id,tokens:upd,live:true}); }
      return;
    }
    if (isDrawingRef.current) {
      currentPathRef.current=[...currentPathRef.current,pos];
      drawFrame();
      // ← Live drawing emit at ~60fps — each new point sent immediately
      if (socket&&now-lastDrawEmit.current>16) {
        lastDrawEmit.current=now;
        socket.emit('map-drawing-live',{sessionId,mapId:activeMapRef.current?.id,pathId:currentPathIdRef.current,point:pos,color:drawColorRef.current,width:drawWidthRef.current});
      }
      return;
    }
    if (isPanningRef.current) { const np={x:e.clientX-panStartRef.current.x,y:e.clientY-panStartRef.current.y}; panOffsetRef.current=np; drawFrame(); return; }
    if (isDraggingRef.current) {
      dragMoved.current=true;
      const sp=snapPos(pos.x,pos.y);
      const upd=tokensRef.current.map(t=>t.id===isDraggingRef.current.id?{...t,...sp}:t);
      tokensRef.current=upd; // no setTokens during drag — avoids React re-renders at 60fps
      tokenVisualsRef.current[isDraggingRef.current.id]=sp; // sync visual so drawFrame shows local movement
      if (selectedTokenRef.current?.id===isDraggingRef.current.id) { const mv=upd.find(t=>t.id===isDraggingRef.current.id); selectedTokenRef.current=mv; } // no setSelectedToken in hot path
      drawFrame();
      // ← Token drag emit at ~60fps (live=true → no DB write, triggers lerp on receivers)
      if (socket&&now-lastDragEmit.current>16) {
        lastDragEmit.current=now;
        socket.emit('map-token-move',{sessionId,mapId:activeMapRef.current?.id,tokens:upd,live:true});
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

    if (editingMapImg) {
      // Sync React state from refs (deferred from mousemove for performance)
      setImgX(imgXRef.current); setImgY(imgYRef.current); setImgScale(imgScaleRef.current);
      emitImgTransform(imgXRef.current,imgYRef.current,imgScaleRef.current); setEditingMapImg(null); return;
    }
    if (fogPainting.current) {
      fogPainting.current=false;
      if (socket&&activeMapRef.current) socket.emit('map-fog-paint',{sessionId,mapId:activeMapRef.current.id,fogCells:Array.from(fogCellsRef.current),gridSize:gridSizeRef.current});
    }
    eraserActive.current=false;
    if (resizingToken.current) {
      if (socket) socket.emit('map-token-move',{sessionId,mapId:activeMapRef.current?.id,tokens:tokensRef.current,live:false});
      resizingToken.current=null;
    }
    if (drawing&&currentPathRef.current.length>1) {
      // Use the SAME id that was used for live segments → receivers clear the live preview
      const newPath={id:currentPathIdRef.current,color:drawColorRef.current,width:drawWidthRef.current,points:currentPathRef.current};
      const next=[...pathsRef.current,newPath]; pathsRef.current=next; setPaths(next);
      currentPathRef.current=[];
      if (socket) {
        socket.emit('map-drawing',{sessionId,mapId:activeMapRef.current?.id,path:newPath});
        socket.emit('map-drawing-finalize',{sessionId,pathId:newPath.id});
      }
    }
    if (wasDragging&&dragMoved.current&&socket) {
      const mv=tokensRef.current.find(t=>t.id===wasDragging.id);
      if (mv) { selectedTokenRef.current=mv; setSelectedToken(mv); }
      setTokens([...tokensRef.current]); // sync React state once after drag (not per-frame)
      socket.emit('map-token-move',{sessionId,mapId:activeMapRef.current?.id,tokens:tokensRef.current,live:false});
    }
    // Single click (no drag) → detect double-click to open edit panel
    if (wasDragging && !dragMoved.current) {
      const now = Date.now();
      const last = tokenLastClickRef.current;
      if (last.id === wasDragging.id && (now - last.time) < 350) {
        setShowTokenEdit(true);
      }
      tokenLastClickRef.current = { id: wasDragging.id, time: now };
    }
    if (wasPanning) setPanOffset({ ...panOffsetRef.current }); // sync state once after pan (deferred from mousemove)
    setDrawing(false); setIsPanning(false); setDragging(null); drawFrame();
  };

  // Wheel zoom — must be non-passive to allow preventDefault
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const nz=clamp(zoomRef.current+(e.deltaY>0?-0.1:0.1),0.2,4);
      zoomRef.current=nz; setZoom(nz); drawFrame();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [drawFrame]);

  const updateToken = (upd) => {
    const next=tokensRef.current.map(t=>t.id===upd.id?upd:t);
    tokensRef.current=next; setTokens(next); selectedTokenRef.current=upd; setSelectedToken(upd); drawFrame();
    if (socket) socket.emit('map-token-move',{sessionId,mapId:activeMapRef.current?.id,tokens:next,live:false});
  };
  const deleteToken = (id) => {
    const next=tokensRef.current.filter(t=>t.id!==id);
    tokensRef.current=next; setTokens(next); selectedTokenRef.current=null; setSelectedToken(null); setShowTokenEdit(false); drawFrame();
    if (socket) socket.emit('map-token-delete',{sessionId,mapId:activeMapRef.current?.id,tokenId:id});
  };
  const confirmPendingDelete = () => {
    const p = pendingDelete; setPendingDelete(null);
    if (!p) return;
    if (p.type === 'token') { deleteToken(p.id); }
    else if (p.type === 'map-image') {
      mapImageRef.current=null; setMapImage(null); drawFrame();
      if (socket&&activeMapRef.current) socket.emit('map-image-clear',{sessionId,mapId:activeMapRef.current.id});
    }
  };
  const clearFog = () => {
    const e=new Set(); fogCellsRef.current=e; setFogCells(e); drawFrame();
    if (socket&&activeMapRef.current) socket.emit('map-fog-paint',{sessionId,mapId:activeMapRef.current.id,fogCells:[],gridSize:gridSizeRef.current});
  };
  const switchMap = (sel) => {
    if (sel.id===activeMapRef.current?.id) return;
    setActiveMap(sel);
    if (isDM&&socket) socket.emit('map-change',{sessionId,mapId:sel.id,currentMapId:activeMapRef.current?.id,tokens:tokensRef.current});
  };
  const resetImgTransform = () => { setImgX(0); setImgY(0); setImgScale(1); drawFrame(); emitImgTransform(0,0,1); };

  const getCursor = () => {
    if (tool==='fog-add'||tool==='fog-erase'||tool==='erase') return 'cell';
    if (tool==='draw') return 'crosshair';
    if (tool==='token') return 'copy';
    if (tool==='map-edit') return editingMapImg?(editingMapImg.type==='move'?'grabbing':'nwse-resize'):'default';
    if (resizingToken.current) return 'nwse-resize';
    if (dragging) return 'grabbing';
    return 'grab';
  };

  const dmTools = isDM ? [
    {id:'draw',icon:'✏️',label:'Dessiner'}, {id:'erase',icon:'🧹',label:'Gomme dessin'},
    {id:'token',icon:'📍',label:'Token'}, {id:'map-edit',icon:'🖼️',label:'Déplacer/redimensionner image'},
    {id:'fog-add',icon:'🌫️',label:'Brouillard +'}, {id:'fog-erase',icon:'🌤️',label:'Brouillard −'},
  ] : [{id:'token',icon:'📍',label:'Token'}];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in" style={{display:'flex',flexDirection:'column',height:'100%',gap:'5px'}}>
      {/* Toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:'5px',flexWrap:'wrap',padding:'5px 8px',background:'var(--bg-tertiary)',borderRadius:'var(--radius-md)'}}>

        <div style={{display:'flex',gap:'2px'}}>
          {[{id:'move',icon:'✋',label:'Déplacer'},...dmTools].map(t=>(
            <button key={t.id} className={`btn btn-sm ${tool===t.id?'btn-primary':'btn-secondary'}`}
              onClick={()=>setTool(t.id)} title={t.label} style={{fontSize:'0.9rem'}}>{t.icon}</button>
          ))}
        </div>

        {tool==='draw'&&isDM&&(
          <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
            <input type="color" value={drawColor} onChange={e=>setDrawColor(e.target.value)} style={{width:'24px',height:'22px',padding:0,border:'none',cursor:'pointer'}} />
            <input type="number" value={drawWidth} onChange={e=>setDrawWidth(clamp(Number(e.target.value),1,20))} min={1} max={20} style={{width:'44px',padding:'2px 4px',fontSize:'0.78rem'}} />
            <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>px</span>
            <button className="btn btn-sm btn-secondary" onClick={()=>{pathsRef.current=[];setPaths([]);if(socket&&activeMapRef.current)socket.emit('map-drawings-clear',{sessionId,mapId:activeMapRef.current.id});}}>🗑️</button>
          </div>
        )}

        {tool==='erase'&&isDM&&(
          <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem'}}>
            <span style={{color:'var(--text-muted)'}}>Gomme</span>
            <input type="number" value={eraserSize} onChange={e=>setEraserSize(Math.max(5,Number(e.target.value)))} min={5} max={200} style={{width:'52px',padding:'2px 4px',fontSize:'0.78rem'}} />
            <span style={{color:'var(--text-muted)'}}>px</span>
          </div>
        )}

        {tool==='map-edit'&&isDM&&(
          <div style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'0.78rem'}}>
            <span style={{color:'var(--text-muted)'}}>Glisser image • Coins = redimensionner</span>
            <button className="btn btn-sm btn-secondary" onClick={resetImgTransform}>↺ Reset</button>
          </div>
        )}

        {isDM&&(tool==='fog-add'||tool==='fog-erase')&&(
          <div style={{display:'flex',alignItems:'center',gap:'4px',flexWrap:'wrap'}}>
            <input type="number" value={fogBrushPx} onChange={e=>{const v=Math.max(10,Number(e.target.value));setFogBrushPx(v);fogBrushPxRef.current=v;}} min={10} max={500} style={{width:'52px',padding:'2px 4px',fontSize:'0.78rem'}} />
            <span style={{fontSize:'0.7rem',color:'var(--text-muted)'}}>px</span>
            <input type="color" value={fogColor} onChange={e=>setFogColor(e.target.value)} style={{width:'24px',height:'22px',padding:0,border:'none',cursor:'pointer'}} />
            {fogCells.size>0&&<button className="btn btn-sm btn-danger" onClick={clearFog}>🗑️{fogCells.size}</button>}
          </div>
        )}

        {/* Fog opacity — always visible for DM */}
        {isDM&&(
          <div style={{display:'flex',alignItems:'center',gap:'3px'}}>
            <span style={{fontSize:'0.68rem',color:'var(--text-muted)',whiteSpace:'nowrap'}}>Fog {Math.round(fogOpacity*100)}%</span>
            <input type="range" min={0.1} max={1} step={0.05} value={fogOpacity}
              onChange={e=>{const v=Number(e.target.value);fogOpacityRef.current=v;setFogOpacity(v);drawFrame();}}
              style={{width:'55px',cursor:'pointer'}} />
          </div>
        )}

        {tool==='token'&&(
          <div style={{display:'flex',gap:'4px',alignItems:'center',flexWrap:'wrap'}}>
            <input type="text" value={newTokenName} onChange={e=>setNewTokenName(e.target.value)} placeholder="Nom" style={{width:'90px',padding:'2px 5px',fontSize:'0.8rem'}} />
            <input type="color" value={newTokenColor} onChange={e=>setNewTokenColor(e.target.value)} style={{width:'24px',height:'22px',padding:0,border:'none',cursor:'pointer'}} />
            <input type="color" value={newTokenBorderColor} onChange={e=>setNewTokenBorderColor(e.target.value)} style={{width:'24px',height:'22px',padding:0,border:'2px solid rgba(255,255,255,0.3)',cursor:'pointer'}} />
            <input type="number" value={newTokenRadius} onChange={e=>setNewTokenRadius(Number(e.target.value))} min={10} max={80} title="Rayon px" style={{width:'44px',padding:'2px 4px',fontSize:'0.78rem'}} />
            <button className="btn btn-sm btn-secondary" onClick={()=>newTokenFileRef.current.click()}>{newTokenImage?'🖼️✓':'🖼️'}</button>
            <input ref={newTokenFileRef} type="file" accept="image/*,.jfif"
              onChange={async e=>{
                const f=e.target.files[0]; if(!f) return;
                const fd=new FormData(); fd.append('image',f);
                const res=await fetch(`${API}/maps/token-image`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:fd});
                if(res.ok){const d=await res.json();setNewTokenImage(`${VITE_API}${d.path}`);}
              }} style={{display:'none'}} />
            {newTokenImage&&<button className="btn btn-sm btn-secondary" onClick={()=>setNewTokenImage(null)}>✕</button>}
          </div>
        )}

        <div style={{width:'1px',height:'20px',background:'var(--border-color)',margin:'0 2px',flexShrink:0}} />

        <button className={`btn btn-sm ${snapToGrid?'btn-primary':'btn-secondary'}`}
          onClick={()=>{setSnapToGrid(v=>!v);snapToGridRef.current=!snapToGrid;}} title="Aligner sur la grille">⊞</button>

        {isDM&&(
          <div style={{display:'flex',alignItems:'center',gap:'3px'}}>
            <span style={{fontSize:'0.68rem',color:'var(--text-muted)'}}>Grille</span>
            <input type="range" min={20} max={120} value={gridSize} onChange={e=>{
              const gs=Number(e.target.value);
              gridSizeRef.current=gs; setGridSize(gs); drawFrame();
              if (socket&&activeMapRef.current) socket.emit('map-grid-size',{sessionId,mapId:activeMapRef.current.id,gridSize:gs});
            }} style={{width:'60px',cursor:'pointer'}} />
            <span style={{fontSize:'0.68rem',color:'var(--text-muted)',minWidth:'24px'}}>{gridSize}px</span>
          </div>
        )}

        <div style={{width:'1px',height:'20px',background:'var(--border-color)',margin:'0 2px',flexShrink:0}} />

        <button className={`btn btn-sm ${showCombat?'btn-primary':'btn-secondary'}`} onClick={()=>setShowCombat(v=>!v)}>⚔️ Combat</button>
        <button className={`btn btn-sm ${showDice?'btn-primary':'btn-secondary'}`} onClick={()=>setShowDice(v=>!v)}>🎲 Dés</button>

        {isDM&&(
          <>
            <label className="btn btn-secondary btn-sm" style={{cursor:'pointer'}}>
              📤 Upload<input type="file" accept="image/*,.jfif,.jpe,.bmp,.tiff,.avif" onChange={uploadMap} style={{display:'none'}} />
            </label>
            {activeMap&&<button className="btn btn-danger btn-sm" onClick={deleteCurrentMap} title="Supprimer cette map">🗑️</button>}
          </>
        )}

        {maps.length>1&&(
          <select value={activeMap?.id||''} onChange={e=>{const s=maps.find(m=>m.id===e.target.value);if(s)switchMap(s);}} style={{padding:'2px 5px',fontSize:'0.78rem',maxWidth:'130px'}}>
            {maps.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}

        <span style={{fontSize:'0.7rem',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{Math.round(zoom*100)}%</span>
        <span style={{fontSize:'0.65rem',color:'var(--text-muted)'}} title="Clic droit = Ping">📌</span>
      </div>

      {/* Token / image-clear confirmation modal */}
      {pendingDelete&&(
        <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(6px)',background:'rgba(0,0,0,0.55)'}} onClick={()=>setPendingDelete(null)}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--accent-danger)',borderRadius:'var(--radius-lg)',padding:'28px 32px',minWidth:'280px',boxShadow:'0 16px 48px rgba(0,0,0,0.8)',textAlign:'center'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:'2rem',marginBottom:'10px'}}>{pendingDelete.type==='token'?'🗑️':'🖼️'}</div>
            <h3 style={{fontFamily:'var(--font-heading)',color:'var(--accent-danger)',marginBottom:'8px'}}>
              {pendingDelete.type==='token'?'Supprimer le token':'Effacer l\'image'}
            </h3>
            <p style={{color:'var(--text-secondary)',marginBottom:'24px',fontSize:'0.9rem'}}>
              {pendingDelete.type==='token'
                ? <>Supprimer <strong style={{color:'var(--text-primary)'}}>{pendingDelete.name||'ce token'}</strong>&nbsp;?</>
                : 'Effacer l\'image de fond de la map définitivement ?'}
            </p>
            <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
              <button className="btn btn-secondary" onClick={()=>setPendingDelete(null)}>Annuler</button>
              <button className="btn btn-danger" onClick={confirmPendingDelete}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete map confirmation modal */}
      {showDeleteConfirm&&(
        <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(6px)',background:'rgba(0,0,0,0.55)'}} onClick={()=>setShowDeleteConfirm(false)}>
          <div style={{background:'var(--bg-secondary)',border:'1px solid var(--accent-danger)',borderRadius:'var(--radius-lg)',padding:'28px 32px',minWidth:'300px',boxShadow:'0 16px 48px rgba(0,0,0,0.8)',textAlign:'center'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:'2rem',marginBottom:'10px'}}>🗑️</div>
            <h3 style={{fontFamily:'var(--font-heading)',color:'var(--accent-danger)',marginBottom:'8px'}}>Supprimer la map</h3>
            <p style={{color:'var(--text-secondary)',marginBottom:'24px',fontSize:'0.9rem'}}>
              Supprimer <strong style={{color:'var(--text-primary)'}}>{activeMap?.name}</strong> définitivement&nbsp;?
            </p>
            <div style={{display:'flex',gap:'10px',justifyContent:'center'}}>
              <button className="btn btn-secondary" onClick={()=>setShowDeleteConfirm(false)}>Annuler</button>
              <button className="btn btn-danger" onClick={confirmDeleteMap}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div ref={containerRef} style={{flex:1,minHeight:'400px',position:'relative',borderRadius:'var(--radius-md)',overflow:'hidden',border:'1px solid var(--border-color)',cursor:getCursor()}}>
        <canvas ref={canvasRef}
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          onContextMenu={e=>e.preventDefault()}
          style={{width:'100%',height:'100%',display:'block'}}
        />
        {showDice&&<FloatingPanel title="🎲 Dés" defaultPos={{x:16,y:16}} defaultSize={{w:300,h:480}} onClose={()=>setShowDice(false)}><DiceRoller sessionId={sessionId}/></FloatingPanel>}
        {showCombat&&<FloatingPanel title="⚔️ Combat" defaultPos={{x:16,y:showDice?450:16}} defaultSize={{w:340,h:540}} onClose={()=>setShowCombat(false)}><CombatTracker sessionId={sessionId} isDM={isDM}/></FloatingPanel>}
        {selectedToken&&showTokenEdit&&<TokenEditPanel token={selectedToken} onUpdate={updateToken} onDelete={()=>setPendingDelete({type:'token',id:selectedToken.id,name:selectedToken.name})} onClose={()=>{setSelectedToken(null);selectedTokenRef.current=null;setShowTokenEdit(false);drawFrame();}}/>}
      </div>
    </div>
  );
}
