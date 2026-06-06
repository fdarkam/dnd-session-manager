import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth, API } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';

export default function CharacterSheet({ sessionId, isDM, members = [], onlineUsers = new Set() }) {
  const { user, token } = useAuth();
  const socket = useSocket();
  const [characters, setCharacters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pdfImporting, setPdfImporting] = useState(false);
  const [pdfMessage, setPdfMessage] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);
  const [userSessions, setUserSessions] = useState([]);
  const [transferring, setTransferring] = useState(false);
  const [assignMsg, setAssignMsg] = useState('');
  const [pendingDeleteChar, setPendingDeleteChar] = useState(null);
  const saveTimeout = useRef(null);

  useEffect(() => {
    fetchCharacters();
  }, [sessionId]);

  // Écouter les assignations en temps réel (le joueur reçoit sa fiche immédiatement)
  useEffect(() => {
    if (!socket) return;
    const handler = (char) => {
      setCharacters(prev => {
        const exists = prev.some(c => c.id === char.id);
        return exists ? prev.map(c => c.id === char.id ? char : c) : [...prev, char];
      });
      setSelected(prev => (prev?.id === char.id ? char : prev || char));
    };
    socket.on('character-assigned', handler);
    return () => socket.off('character-assigned', handler);
  }, [socket]);

  // Retrait en temps réel quand le MJ supprime une fiche — évite un rechargement côté joueur
  useEffect(() => {
    if (!socket) return;
    const handler = ({ characterId }) => {
      setCharacters(prev => prev.filter(c => c.id !== characterId));
      // Désélectionner si la fiche supprimée était affichée
      setSelected(prev => (prev?.id === characterId ? null : prev));
    };
    socket.on('character-deleted', handler);
    return () => socket.off('character-deleted', handler);
  }, [socket]);

  const fetchCharacters = async () => {
    const res = await fetch(`${API}/characters/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setCharacters(data);
      if (data.length > 0 && !selected) setSelected(data[0]);
    }
  };

  const createCharacter = async () => {
    const res = await fetch(`${API}/characters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId })
    });
    if (res.ok) {
      const char = await res.json();
      setCharacters(prev => [...prev, char]);
      setSelected(char);
    }
  };

  const autoSave = useCallback((char) => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    setSaving(true);
    saveTimeout.current = setTimeout(async () => {
      try {
        await fetch(`${API}/characters/${char.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(char)
        });
      } catch (err) {
        console.error('Auto-save error:', err);
      }
      setSaving(false);
    }, 800);
  }, [token]);

  const updateField = (field, value) => {
    const updated = { ...selected, [field]: value };
    setSelected(updated);
    setCharacters(prev => prev.map(c => c.id === updated.id ? updated : c));
    autoSave(updated);
  };

  const exportCharacter = async () => {
    if (!selected) return;
    const res = await fetch(`${API}/characters/${selected.id}/export`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected.name || 'personnage'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const importCharacter = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const res = await fetch(`${API}/characters/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId, character_data: data })
      });
      if (res.ok) fetchCharacters();
    } catch (err) {
      alert('Fichier JSON invalide');
    }
  };

  // ---- PDF Import ----
  const importPdf = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    setPdfImporting(true);
    setPdfMessage('');
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('session_id', sessionId);
      const res = await fetch(`${API}/characters/import-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPdfMessage(data.message || 'PDF importé !');
      await fetchCharacters();
      if (data.character) setSelected(data.character);
    } catch (err) {
      setPdfMessage('❌ ' + err.message);
    } finally {
      setPdfImporting(false);
      setTimeout(() => setPdfMessage(''), 5000);
    }
  };

  // ---- Transfer to another session ----
  const openTransferModal = async () => {
    const res = await fetch(`${API}/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const sessions = await res.json();
      // Filter out current session
      setUserSessions(sessions.filter(s => s.id !== sessionId));
    }
    setShowTransfer(true);
  };

  const transferCharacter = async (targetSessionId) => {
    if (!selected) return;
    setTransferring(true);
    try {
      const res = await fetch(`${API}/characters/${selected.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ target_session_id: targetSessionId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      alert(data.message || 'Personnage transféré !');
      setShowTransfer(false);
    } catch (err) {
      alert('❌ ' + err.message);
    } finally {
      setTransferring(false);
    }
  };

  const deleteCharacter = (id) => {
    const char = characters.find(c => c.id === id);
    setPendingDeleteChar({ id, name: char?.name || 'ce personnage' });
  };

  const confirmDeleteCharacter = async () => {
    if (!pendingDeleteChar) return;
    await fetch(`${API}/characters/${pendingDeleteChar.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    // Le retrait local est géré par le listener character-deleted via socket
    setPendingDeleteChar(null);
  };

  const assignCharacter = async (userId) => {
    if (!selected) return;
    setAssignMsg('');
    const res = await fetch(`${API}/characters/${selected.id}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ assigned_user_id: userId || null })
    });
    const data = await res.json();
    if (!res.ok) {
      setAssignMsg('❌ ' + data.error);
      return;
    }
    setAssignMsg('✅ Assigné !');
    setSelected(data);
    setCharacters(prev => prev.map(c => c.id === data.id ? data : c));
    setTimeout(() => setAssignMsg(''), 3000);
  };

  const canEdit = isDM;

  const getModifier = (stat) => {
    const mod = Math.floor((stat - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  };

  const hpPercent = selected ? (selected.hp_current / Math.max(selected.hp_max, 1)) * 100 : 100;
  const hpClass = hpPercent > 60 ? 'hp-high' : hpPercent > 30 ? 'hp-mid' : 'hp-low';

  let inventory = [];
  try {
    inventory = typeof selected?.inventory === 'string' ? JSON.parse(selected.inventory) : (selected?.inventory || []);
  } catch { inventory = []; }

  let skills = [];
  try {
    skills = typeof selected?.skills === 'string' ? JSON.parse(selected.skills) : (selected?.skills || []);
  } catch { skills = []; }

  return (
    <div className="animate-fade-in" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--space-md)' }}>
      {/* Confirmation suppression personnage */}
      {pendingDeleteChar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="card" style={{ maxWidth: 360, width: '90%', textAlign: 'center', padding: 'var(--space-lg)' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>🗑️</div>
            <h3 style={{ fontFamily: 'var(--font-heading)', marginBottom: 'var(--space-sm)' }}>Supprimer le personnage ?</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
              « {pendingDeleteChar.name} » sera définitivement supprimé.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center' }}>
              <button className="btn btn-secondary" onClick={() => setPendingDeleteChar(null)}>Annuler</button>
              <button className="btn btn-danger" onClick={confirmDeleteCharacter}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Member presence bar */}
      {members.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
          padding: '6px var(--space-md)', marginBottom: 'var(--space-sm)',
          background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-color)',
        }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>👥</span>
          {members.map(m => {
            const isOnline = onlineUsers.has(m.id);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={isOnline ? 'En ligne' : 'Hors ligne'}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isOnline ? '#22c55e' : 'var(--text-muted)',
                  boxShadow: isOnline ? '0 0 4px #22c55e88' : 'none',
                }} />
                <span style={{ fontSize: '0.72rem', color: isOnline ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {m.username}{m.role === 'dm' ? ' 👑' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Character Selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
        {characters.map(c => (
          <button
            key={c.id}
            className={`btn ${selected?.id === c.id ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setSelected(c)}
          >
            {c.name || 'Sans nom'}
            {isDM && (c.assigned_player_name || c.player_name) && (
              <span style={{ opacity: 0.7, marginLeft: '4px' }}>({c.assigned_player_name || c.player_name})</span>
            )}
          </button>
        ))}
        {isDM && <button className="btn btn-secondary btn-sm" onClick={createCharacter}>+ Nouveau</button>}
        {/* Fix 2 — Import JSON, Import PDF et Transfert réservés au MJ */}
        {isDM && (
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
            📥 JSON
            <input type="file" accept=".json" onChange={importCharacter} style={{ display: 'none' }} />
          </label>
        )}
        {isDM && (
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', borderColor: pdfImporting ? 'var(--accent-primary)' : undefined }}>
            {pdfImporting ? '⏳ Import...' : '📄 Import PDF'}
            <input type="file" accept=".pdf" onChange={importPdf} disabled={pdfImporting} style={{ display: 'none' }} />
          </label>
        )}
        {isDM && selected && (
          <button className="btn btn-secondary btn-sm" onClick={openTransferModal}>🔄 Transférer</button>
        )}
        {saving && <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>💾 Sauvegarde...</span>}
      </div>

      {/* PDF import feedback */}
      {pdfMessage && (
        <div style={{
          padding: '10px 14px',
          background: pdfMessage.startsWith('❌') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
          border: `1px solid ${pdfMessage.startsWith('❌') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
          borderRadius: 'var(--radius-sm)',
          color: pdfMessage.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
          fontSize: '0.85rem',
          marginBottom: 'var(--space-md)',
          animation: 'slideUp 0.2s ease'
        }}>
          {pdfMessage}
        </div>
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }} onClick={() => setShowTransfer(false)}>
          <div className="card animate-slide-up" style={{ maxWidth: '460px', width: '90%', maxHeight: '70vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', marginBottom: 'var(--space-md)' }}>
              🔄 Transférer "{selected?.name}" vers une autre session
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
              Le personnage sera copié dans la session choisie (l'original reste ici).
            </p>
            {userSessions.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--space-lg)' }}>
                Aucune autre session disponible. Rejoignez ou créez une autre session d'abord.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                {userSessions.map(s => (
                  <button
                    key={s.id}
                    className="btn btn-secondary"
                    onClick={() => transferCharacter(s.id)}
                    disabled={transferring}
                    style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  >
                    <span>{s.name}</span>
                    <span className={`badge ${s.dm_id === user.id ? 'badge-dm' : 'badge-player'}`} style={{ marginLeft: 'auto', fontSize: '0.6rem' }}>
                      {s.dm_id === user.id ? 'MJ' : 'Joueur'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-secondary mt-md w-full" onClick={() => setShowTransfer(false)}>Annuler</button>
          </div>
        </div>
      )}

      {!selected ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-sm)' }}>📜</div>
          <p style={{ color: 'var(--text-muted)' }}>Sélectionnez ou créez un personnage</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: 'var(--space-sm)' }}>
            Vous pouvez aussi importer un fichier PDF de fiche personnage
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
          {/* Left Column - Identity & Stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem' }}>⚔️ Identité</h3>
                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                  <button className="btn btn-secondary btn-sm" onClick={exportCharacter}>📤 Export</button>
                  {(isDM || selected.user_id === user.id) && (
                    <button className="btn btn-danger btn-sm" onClick={() => deleteCharacter(selected.id)}>🗑️</button>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label>Nom</label>
                <input
                  type="text"
                  value={selected.name || ''}
                  onChange={(e) => updateField('name', e.target.value)}
                  disabled={!canEdit}
                  placeholder="Nom du personnage"
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-sm)' }}>
                <div className="form-group">
                  <label>Race</label>
                  <input type="text" value={selected.race || ''} onChange={(e) => updateField('race', e.target.value)} disabled={!canEdit} placeholder="Elfe, Nain..." />
                </div>
                <div className="form-group">
                  <label>Classe</label>
                  <input type="text" value={selected.class || ''} onChange={(e) => updateField('class', e.target.value)} disabled={!canEdit} placeholder="Guerrier..." />
                </div>
              </div>
              <div className="form-group">
                <label>Niveau</label>
                <input type="number" value={selected.level || 1} onChange={(e) => updateField('level', parseInt(e.target.value) || 1)} disabled={!canEdit} min={1} max={20} />
              </div>
              {isDM && (
                <div className="form-group">
                  <label>Joueur assigné</label>
                  <select
                    value={selected.assigned_user_id || ''}
                    onChange={(e) => assignCharacter(e.target.value)}
                  >
                    <option value="">— Non assigné —</option>
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.username}</option>
                    ))}
                  </select>
                  {assignMsg && (
                    <div style={{
                      fontSize: '0.8rem', marginTop: '4px',
                      color: assignMsg.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)'
                    }}>{assignMsg}</div>
                  )}
                </div>
              )}
            </div>

            {/* HP */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>❤️ Points de Vie</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                <input
                  type="number"
                  value={selected.hp_current ?? 10}
                  onChange={(e) => updateField('hp_current', parseInt(e.target.value) || 0)}
                  disabled={!canEdit}
                  style={{ width: '80px', textAlign: 'center', fontSize: '1.4rem', fontWeight: 700 }}
                />
                <span style={{ fontSize: '1.5rem', color: 'var(--text-muted)' }}>/</span>
                <input
                  type="number"
                  value={selected.hp_max ?? 10}
                  onChange={(e) => updateField('hp_max', parseInt(e.target.value) || 1)}
                  disabled={!canEdit}
                  style={{ width: '80px', textAlign: 'center', fontSize: '1.4rem', fontWeight: 700 }}
                />
              </div>
              <div className="hp-bar-container">
                <div className={`hp-bar ${hpClass}`} style={{ width: `${Math.min(100, Math.max(0, hpPercent))}%` }} />
              </div>
            </div>

            {/* Stats */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>📊 Caractéristiques</h3>
              <div className="stat-grid">
                {[
                  { key: 'str', label: 'FOR' },
                  { key: 'dex', label: 'DEX' },
                  { key: 'con', label: 'CON' },
                  { key: 'intel', label: 'INT' },
                  { key: 'wis', label: 'SAG' },
                  { key: 'cha', label: 'CHA' }
                ].map(stat => (
                  <div key={stat.key} className="stat-box">
                    <div className="stat-label">{stat.label}</div>
                    {canEdit ? (
                      <input
                        type="number"
                        className="stat-input"
                        value={selected[stat.key] ?? 10}
                        onChange={(e) => updateField(stat.key, parseInt(e.target.value) || 0)}
                        min={1}
                        max={30}
                      />
                    ) : (
                      <div className="stat-value">{selected[stat.key] ?? 10}</div>
                    )}
                    <div className="stat-mod">{getModifier(selected[stat.key] ?? 10)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column - Inventory, Skills, Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {/* Inventory */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>🎒 Inventaire</h3>
              {inventory.map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                  <input
                    type="text"
                    value={item}
                    onChange={(e) => {
                      const updated = [...inventory];
                      updated[i] = e.target.value;
                      updateField('inventory', JSON.stringify(updated));
                    }}
                    disabled={!canEdit}
                    style={{ flex: 1 }}
                  />
                  {canEdit && (
                    <button className="btn-icon" onClick={() => {
                      const updated = inventory.filter((_, j) => j !== i);
                      updateField('inventory', JSON.stringify(updated));
                    }}>✕</button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button className="btn btn-secondary btn-sm mt-sm" onClick={() => {
                  updateField('inventory', JSON.stringify([...inventory, 'Nouvel objet']));
                }}>+ Ajouter un objet</button>
              )}
            </div>

            {/* Skills */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>🌟 Compétences</h3>
              {skills.map((skill, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                  <input
                    type="text"
                    value={skill}
                    onChange={(e) => {
                      const updated = [...skills];
                      updated[i] = e.target.value;
                      updateField('skills', JSON.stringify(updated));
                    }}
                    disabled={!canEdit}
                    style={{ flex: 1 }}
                  />
                  {canEdit && (
                    <button className="btn-icon" onClick={() => {
                      const updated = skills.filter((_, j) => j !== i);
                      updateField('skills', JSON.stringify(updated));
                    }}>✕</button>
                  )}
                </div>
              ))}
              {canEdit && (
                <button className="btn btn-secondary btn-sm mt-sm" onClick={() => {
                  updateField('skills', JSON.stringify([...skills, 'Nouvelle compétence']));
                }}>+ Ajouter une compétence</button>
              )}
            </div>

            {/* Notes */}
            <div className="card">
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: 'var(--space-sm)' }}>📝 Notes</h3>
              <textarea
                value={selected.notes || ''}
                onChange={(e) => updateField('notes', e.target.value)}
                disabled={!canEdit}
                placeholder="Notes libres..."
                rows={6}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
