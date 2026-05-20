import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';

export default function MapCanvas({ sessionId, isDM }) {
  const socket = useSocket();
  const { token } = useAuth();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  const [maps, setMaps] = useState([]);
  const [activeMap, setActiveMap] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [tool, setTool] = useState('move'); // move, draw, token
  const [drawing, setDrawing] = useState(false);
  const [paths, setPaths] = useState([]);
  const [currentPath, setCurrentPath] = useState([]);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [image, setImage] = useState(null);

  // New token form
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenColor, setNewTokenColor] = useState('#c9a84c');

  useEffect(() => { fetchMaps(); }, [sessionId]);

  useEffect(() => {
    if (!socket) return;
    const onTokenUpdate = (data) => {
      if (data.mapId === activeMap?.id) {
        setTokens(typeof data.tokens === 'string' ? JSON.parse(data.tokens) : data.tokens);
      }
    };
    const onDrawing = (data) => {
      if (data.mapId === activeMap?.id) {
        setPaths(prev => [...prev, data.path]);
      }
    };
    socket.on('map-token-update', onTokenUpdate);
    socket.on('map-drawing-update', onDrawing);
    return () => {
      socket.off('map-token-update', onTokenUpdate);
      socket.off('map-drawing-update', onDrawing);
    };
  }, [socket, activeMap]);

  useEffect(() => {
    if (activeMap) {
      const img = new Image();
      img.src = `http://localhost:3001${activeMap.image_path}`;
      img.onload = () => setImage(img);
      setTokens(typeof activeMap.tokens === 'string' ? JSON.parse(activeMap.tokens) : (activeMap.tokens || []));
      setPaths([]);
    }
  }, [activeMap]);

  useEffect(() => { draw(); }, [image, tokens, paths, currentPath, panOffset, zoom]);

  const fetchMaps = async () => {
    const res = await fetch(`${API}/maps/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setMaps(data);
      const active = data.find(m => m.is_active);
      if (active) setActiveMap(active);
      else if (data.length > 0) setActiveMap(data[0]);
    }
  };

  const uploadMap = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    formData.append('session_id', sessionId);
    formData.append('name', file.name.replace(/\.[^.]+$/, ''));

    const res = await fetch(`${API}/maps`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    if (res.ok) fetchMaps();
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = containerRef.current;
    if (container) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw image
    if (image) {
      ctx.drawImage(image, 0, 0);
    } else {
      // Grid background
      ctx.fillStyle = '#1c2033';
      ctx.fillRect(0, 0, canvas.width / zoom, canvas.height / zoom);
      ctx.strokeStyle = '#2a2d3e';
      const gridSize = 50;
      for (let x = 0; x < (canvas.width / zoom + 200); x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height / zoom + 200);
        ctx.stroke();
      }
      for (let y = 0; y < (canvas.height / zoom + 200); y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width / zoom + 200, y);
        ctx.stroke();
      }
    }

    // Draw paths
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    [...paths, currentPath.length > 0 ? currentPath : null].filter(Boolean).forEach(path => {
      if (path.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      path.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });

    // Draw tokens
    tokens.forEach(t => {
      const size = 20;
      ctx.beginPath();
      ctx.arc(t.x, t.y, size, 0, Math.PI * 2);
      ctx.fillStyle = t.color || '#c9a84c';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = t.name.length > 3 ? t.name.substring(0, 3) : t.name;
      ctx.fillText(label, t.x, t.y);
    });

    ctx.restore();
  }, [image, tokens, paths, currentPath, panOffset, zoom]);

  const getCanvasPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - panOffset.x) / zoom,
      y: (e.clientY - rect.top - panOffset.y) / zoom
    };
  };

  const handleMouseDown = (e) => {
    const pos = getCanvasPos(e);

    if (tool === 'move' || e.button === 1) {
      // Check if clicking on a token
      if (isDM) {
        const clicked = tokens.find(t => {
          const dx = t.x - pos.x;
          const dy = t.y - pos.y;
          return Math.sqrt(dx * dx + dy * dy) < 20;
        });
        if (clicked) {
          setDragging(clicked);
          return;
        }
      }
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    } else if (tool === 'draw' && isDM) {
      setDrawing(true);
      setCurrentPath([pos]);
    } else if (tool === 'token' && isDM) {
      if (newTokenName.trim()) {
        const newToken = {
          id: Date.now().toString(),
          name: newTokenName,
          color: newTokenColor,
          x: pos.x,
          y: pos.y
        };
        const updated = [...tokens, newToken];
        setTokens(updated);
        if (socket) socket.emit('map-token-move', { sessionId, mapId: activeMap?.id, tokens: updated });
      }
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    } else if (drawing) {
      const pos = getCanvasPos(e);
      setCurrentPath(prev => [...prev, pos]);
    } else if (dragging) {
      const pos = getCanvasPos(e);
      const updated = tokens.map(t =>
        t.id === dragging.id ? { ...t, x: pos.x, y: pos.y } : t
      );
      setTokens(updated);
    }
  };

  const handleMouseUp = () => {
    if (drawing && currentPath.length > 1) {
      setPaths(prev => [...prev, currentPath]);
      if (socket) socket.emit('map-drawing', { sessionId, mapId: activeMap?.id, path: currentPath });
      setCurrentPath([]);
    }
    if (dragging) {
      if (socket) socket.emit('map-token-move', { sessionId, mapId: activeMap?.id, tokens });
    }
    setDrawing(false);
    setIsPanning(false);
    setDragging(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.max(0.2, Math.min(3, prev + delta)));
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-sm)',
        padding: 'var(--space-sm)',
        background: 'var(--bg-tertiary)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-sm)',
        flexWrap: 'wrap'
      }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {[
            { id: 'move', icon: '✋', label: 'Déplacer' },
            ...(isDM ? [
              { id: 'draw', icon: '✏️', label: 'Dessiner' },
              { id: 'token', icon: '📍', label: 'Token' },
            ] : [])
          ].map(t => (
            <button
              key={t.id}
              className={`btn btn-sm ${tool === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>

        {tool === 'token' && isDM && (
          <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
            <input
              type="text"
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              placeholder="Nom du token"
              style={{ width: '120px', padding: '4px 8px', fontSize: '0.8rem' }}
            />
            <input
              type="color"
              value={newTokenColor}
              onChange={(e) => setNewTokenColor(e.target.value)}
              style={{ width: '32px', height: '28px', padding: 0, cursor: 'pointer' }}
            />
          </div>
        )}

        {isDM && (
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', marginLeft: 'auto' }}>
            📤 Upload Map
            <input type="file" accept="image/*" onChange={uploadMap} style={{ display: 'none' }} />
          </label>
        )}

        {/* Map Selector */}
        {maps.length > 1 && (
          <select
            value={activeMap?.id || ''}
            onChange={(e) => setActiveMap(maps.find(m => m.id === e.target.value))}
            style={{ padding: '4px 8px', fontSize: '0.8rem' }}
          >
            {maps.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: '400px',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          cursor: tool === 'draw' ? 'crosshair' : tool === 'token' ? 'cell' : dragging ? 'grabbing' : 'grab'
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
