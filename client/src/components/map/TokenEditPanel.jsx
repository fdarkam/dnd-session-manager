import { useState, useEffect, useRef } from 'react';
import { useAuth, API } from '../../contexts/AuthContext';
import { useDraggable } from '../../hooks/useDraggable';
import { CONDITIONS } from '../../domain/conditions';

const VITE_API = import.meta.env.VITE_API_URL;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ─── Token edit panel (draggable) ────────────────────────────────────────────
function TokenEditPanel({ token, onUpdate, onDelete, onClose, isDM, initialPos, onToggleCondition, sessionId }) {
  const { token: authToken, user } = useAuth();
  const canEdit = isDM || !token.createdBy || token.createdBy === user?.id;
  const [name, setName] = useState(token.name || '');
  const [color, setColor] = useState(token.color || '#c9a84c');
  const [borderColor, setBorderColor] = useState(token.borderColor || '#ffffff');
  const [radius, setRadius] = useState(token.radius || 22);
  const [image, setImage] = useState(token.image || null);
  const [hidden, setHidden] = useState(!!token.hidden);
  const [locked, setLocked] = useState(!!token.locked);
  // visionRadius : 0 = aveugle (MJ only), 'normal' = standard, 'enhanced' = nocturne étendue
  // Fallback sur nightVision (boolean) pour les anciens tokens sans visionRadius
  const [visionRadius, setVisionRadius] = useState(
    token.visionRadius !== undefined ? token.visionRadius : (token.nightVision ? 'enhanced' : 'normal')
  );
  // characterId : lien optionnel vers un personnage — synchro automatique des statuts combat
  const [characterId, setCharacterId] = useState(token.characterId || null);
  const [characters, setCharacters] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  // Fix 4: position draggable
  const [pos, setPos] = useState(initialPos || { x: 8, y: 8 });

  useEffect(() => {
    setName(token.name || ''); setColor(token.color || '#c9a84c'); setBorderColor(token.borderColor || '#ffffff');
    setRadius(token.radius || 22); setImage(token.image || null); setHidden(!!token.hidden);
    setLocked(!!token.locked);
    // Sync visionRadius — priorité à visionRadius, fallback sur nightVision pour les anciens tokens
    setVisionRadius(token.visionRadius !== undefined ? token.visionRadius : (token.nightVision ? 'enhanced' : 'normal'));
    setCharacterId(token.characterId || null);
  }, [token.id]);

  // Repositionner quand un token différent est ouvert
  useEffect(() => { if (initialPos) setPos(initialPos); }, [token.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charger les personnages de la session pour le lien token↔combat (MJ uniquement)
  useEffect(() => {
    if (!isDM || !sessionId) return;
    fetch(`${API}/sessions/${sessionId}/characters`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : [])
      .then(data => setCharacters(Array.isArray(data) ? data : []))
      .catch(() => setCharacters([]));
  }, [isDM, sessionId, authToken]);

  const startDrag = useDraggable(pos, setPos, (rawX, rawY) => ({
    x: Math.max(0, rawX),
    y: Math.max(0, rawY),
  }));

  const handleFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('image', f);
      const res = await fetch(`${API}/maps/token-image`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: fd });
      if (res.ok) { const data = await res.json(); setImage(`${VITE_API}${data.path}`); }
    } catch { /* ignore */ }
    setUploading(false);
  };
  const apply = () => onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius, nightVision: visionRadius === 'enhanced', characterId });
  // Met à jour visionRadius et synchronise nightVision (rétrocompat) en un seul appel
  const updateVision = (vr) => {
    setVisionRadius(vr);
    onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius: vr, nightVision: vr === 'enhanced' });
  };

  return (
    <div style={{ position: 'absolute', left: pos.x, top: pos.y, width: 240, background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', borderRadius: 'var(--radius-md)', zIndex: 300, boxShadow: '0 8px 32px rgba(0,0,0,0.7)', padding: '10px' }}>
      {/* En-tête draggable */}
      <div onMouseDown={startDrag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', cursor: 'grab', userSelect: 'none' }}>
        <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.8rem', fontFamily: 'var(--font-heading)' }}>Modifier token</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {token.createdByName && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Créé par {token.createdByName}</span>
        )}
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Nom" style={{ fontSize: '0.82rem', padding: '4px 7px' }} onKeyDown={e => e.key === 'Enter' && canEdit && apply()} disabled={!canEdit} />
        <div style={{ display: 'flex', gap: '5px', alignItems: 'center', fontSize: '0.78rem' }}>
          <label style={{ color: 'var(--text-muted)' }}>Fond</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '26px', height: '22px', padding: 0, border: 'none', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4 }} disabled={!canEdit} />
          <label style={{ color: 'var(--text-muted)' }}>Bord.</label>
          <input type="color" value={borderColor} onChange={e => setBorderColor(e.target.value)} style={{ width: '26px', height: '22px', padding: 0, border: 'none', cursor: canEdit ? 'pointer' : 'not-allowed', opacity: canEdit ? 1 : 0.4 }} disabled={!canEdit} />
          <label style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>Rayon px</label>
          <input type="number" value={radius} onChange={e => setRadius(Number(e.target.value))} min={10} max={120} style={{ width: '50px', padding: '3px 5px', fontSize: '0.8rem' }} disabled={!canEdit} />
        </div>
        {image && <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><img src={image} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />{canEdit && <button className="btn btn-sm btn-secondary" style={{ fontSize: '0.72rem' }} onClick={() => setImage(null)}>✕</button>}</div>}
        {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()} disabled={uploading} style={{ fontSize: '0.78rem' }}>🖼️ {uploading ? '...' : (image ? 'Changer' : 'Upload image')}</button>}
        <input ref={fileRef} type="file" accept="image/*,.jfif" onChange={handleFile} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: '5px', marginTop: '2px' }}>
          <button className="btn btn-primary btn-sm" onClick={apply} style={{ flex: 1, fontSize: '0.8rem' }} disabled={!canEdit}>Appliquer</button>
          {(isDM || canEdit) && <button className="btn btn-danger btn-sm" onClick={onDelete} title="Supprimer (Suppr)">🗑️</button>}
        </div>
        {isDM && (
          <>
            {/* Fix 1 : boutons sur une seule ligne — gap + padding compacts pour tenir dans 240px */}
            <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
              <button
                className={`btn btn-sm ${hidden ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = !hidden; setHidden(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden: next, locked, visionRadius, nightVision: visionRadius === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
              >{hidden ? '👁️ Révéler' : '🙈 Masquer'}</button>
              <button
                className={`btn btn-sm ${locked ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = !locked; setLocked(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked: next, visionRadius, nightVision: visionRadius === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
              >{locked ? '🔓 Déverr.' : '🔒 Verr.'}</button>
              <button
                className={`btn btn-sm ${visionRadius === 'enhanced' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => { const next = visionRadius === 'enhanced' ? 'normal' : 'enhanced'; setVisionRadius(next); onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius: next, nightVision: next === 'enhanced' }); }}
                style={{ flex: 1, fontSize: '12px', padding: '6px 4px' }}
                title="Vision nocturne — radius de vision étendu à 6 cases"
              >{visionRadius === 'enhanced' ? '🌙 Nuit ✓' : '🌙 Nuit'}</button>
            </div>
          </>
        )}
        {/* Sélecteur Vision — réservé au MJ uniquement, entièrement masqué pour les joueurs */}
        {isDM && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
            <span style={{ fontSize: '11px', color: '#aaa', flexShrink: 0 }}>Vision :</span>
            <div style={{ display: 'flex', gap: '3px', flex: 1 }}>
              <button
                onClick={() => updateVision(0)}
                style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 0 ? '#c0392b' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}
              >🚫 Aveugle</button>
              <button
                onClick={() => updateVision('normal')}
                style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 'normal' ? '#2d6a4f' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}
              >Normal</button>
              <button
                onClick={() => updateVision('enhanced')}
                style={{ flex: 1, fontSize: '11px', padding: '4px 2px', background: visionRadius === 'enhanced' ? '#1a4a8a' : 'transparent', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}
              >Étendu</button>
            </div>
          </div>
        )}
        {/* Lien token↔personnage — synchro automatique des statuts de combat (MJ uniquement) */}
        {isDM && characters.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
            <span style={{ fontSize: '11px', color: '#aaa', flexShrink: 0 }}>Perso :</span>
            <select
              value={characterId || ''}
              onChange={e => {
                const val = e.target.value || null;
                setCharacterId(val);
                onUpdate({ ...token, name, color, borderColor, radius: clamp(radius, 10, 120), image, hidden, locked, visionRadius, nightVision: visionRadius === 'enhanced', characterId: val });
              }}
              style={{ flex: 1, fontSize: '11px', padding: '3px 4px', background: 'var(--bg-tertiary)', border: '1px solid #555', borderRadius: '4px', color: '#fff' }}
            >
              <option value="">— Aucun —</option>
              {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textAlign: 'center' }}>Suppr pour effacer • Glisser coin pour redimensionner</span>

        {/* Section Conditions — accessible à tous (MJ et joueur propriétaire) */}
        <div style={{ borderTop: '1px solid #333', paddingTop: '6px', marginTop: '2px' }}>
          <span style={{ fontSize: '0.72rem', color: '#aaa', display: 'block', marginBottom: '4px' }}>Conditions</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
            {CONDITIONS.map(condition => {
              const active = token.conditions?.includes(condition.id);
              return (
                <button
                  key={condition.id}
                  onClick={() => onToggleCondition(token.id, condition.id)}
                  title={condition.label}
                  style={{
                    padding: '2px 5px', fontSize: '13px', borderRadius: '4px',
                    border: `1px solid ${active ? condition.color : '#555'}`,
                    background: active ? condition.color : 'transparent',
                    cursor: 'pointer', opacity: active ? 1 : 0.35,
                    transition: 'opacity 0.15s, background 0.15s',
                  }}
                >
                  {condition.emoji}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TokenEditPanel;
