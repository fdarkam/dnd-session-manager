import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';

export default function QuestTracker({ sessionId, isDM }) {
  const [quests, setQuests] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [filter, setFilter] = useState('all'); // all | active | completed

  useEffect(() => { fetchQuests(); }, [sessionId]);

  const fetchQuests = async () => {
    const res = await apiGet(`/quests/session/${sessionId}`);
    if (res.ok) setQuests(await res.json());
  };

  const createQuest = async () => {
    if (!title.trim()) return;
    const res = await apiPost('/quests', { session_id: sessionId, title, description, is_private: isPrivate });
    if (res.ok) { setTitle(''); setDescription(''); setIsPrivate(false); fetchQuests(); }
  };

  const updateQuest = async (id, data) => {
    const res = await apiPut(`/quests/${id}`, data);
    if (res.ok) { setEditingId(null); fetchQuests(); }
  };

  const deleteQuest = async (id) => {
    const res = await apiDelete(`/quests/${id}`);
    if (res.ok) fetchQuests();
  };

  const toggleStatus = (q) => updateQuest(q.id, { status: q.status === 'active' ? 'completed' : 'active' });

  const filtered = quests.filter(q => filter === 'all' || q.status === filter);

  const statusBadge = (status) => ({
    active: { label: 'En cours', color: 'var(--accent-primary)' },
    completed: { label: 'Terminée', color: 'var(--accent-success)' },
  }[status] || { label: status, color: 'var(--text-muted)' });

  return (
    <div className="animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 'var(--space-md)', gap: 'var(--space-md)', overflowY: 'auto' }}>
      {/* New quest form (DM only) */}
      {isDM && (
        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', marginBottom: 'var(--space-sm)', fontSize: '1rem' }}>
            + Nouvelle Quête
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Titre de la quête" onKeyDown={e => e.key === 'Enter' && createQuest()} />
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Description..." rows={3}
              style={{ resize: 'vertical', padding: '8px 12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} />
                🔒 Quête privée (invisible aux joueurs)
              </label>
              <button className="btn btn-primary" onClick={createQuest} disabled={!title.trim()}>Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[['all', 'Toutes'], ['active', 'En cours'], ['completed', 'Terminées']].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${filter === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(v)}>{l}</button>
        ))}
      </div>

      {/* Quest list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-sm)' }}>📜</div>
          <p>Aucune quête</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {filtered.map(q => {
            const badge = statusBadge(q.status);
            const isEditing = editingId === q.id;
            return (
              <div key={q.id} className="card" style={{ borderLeft: `3px solid ${badge.color}` }}>
                {isEditing ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input type="text" value={editData.title || ''} onChange={e => setEditData(d => ({ ...d, title: e.target.value }))} />
                    <textarea value={editData.description || ''} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} rows={3}
                      style={{ resize: 'vertical', padding: '6px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.85rem' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.82rem' }}>
                      <input type="checkbox" checked={!!editData.is_private} onChange={e => setEditData(d => ({ ...d, is_private: e.target.checked ? 1 : 0 })) } />
                      🔒 Privée
                    </label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => updateQuest(q.id, editData)}>Sauvegarder</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Annuler</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <h4 style={{ fontFamily: 'var(--font-heading)', margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>
                            {q.status === 'completed' ? '✅' : '🎯'} {q.title}
                          </h4>
                          <span style={{ fontSize: '0.72rem', padding: '2px 7px', borderRadius: '999px', border: `1px solid ${badge.color}`, color: badge.color }}>{badge.label}</span>
                          {q.is_private ? <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>🔒 Privée</span> : null}
                        </div>
                        {q.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>{q.description}</p>}
                      </div>
                      {isDM && (
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => toggleStatus(q)} title={q.status === 'active' ? 'Marquer terminée' : 'Réactiver'}>
                            {q.status === 'active' ? '✅' : '🔄'}
                          </button>
                          <button className="btn btn-sm btn-secondary" onClick={() => { setEditingId(q.id); setEditData({ title: q.title, description: q.description, is_private: q.is_private }); }}>✏️</button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteQuest(q.id)}>🗑️</button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
