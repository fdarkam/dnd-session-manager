import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';
import { useSocket } from '../contexts/SocketContext';

const CATEGORIES = [
  { id: 'Général', icon: '📄' },
  { id: 'Monde', icon: '🌍' },
  { id: 'PNJs', icon: '👥' },
  { id: 'Lieux', icon: '📌' },
  { id: 'Lore', icon: '📚' },
];

export default function WikiPanel({ sessionId, isDM }) {
  const socket = useSocket();
  const [pages, setPages] = useState([]);
  const [selectedCat, setSelectedCat] = useState('Général');
  const [selectedPage, setSelectedPage] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newCat, setNewCat] = useState('Général');

  useEffect(() => { fetchPages(); }, [sessionId]);

  // Mise à jour temps réel : refetch la liste des pages quand le MJ crée, modifie ou supprime une page
  useEffect(() => {
    if (!socket) return;
    const handler = ({ action, pageId }) => {
      fetchPages();
      // Si la page actuellement affichée est supprimée, la désélectionner
      if (action === 'deleted') {
        setSelectedPage(prev => (prev?.id === pageId ? null : prev));
        setEditing(false);
      }
    };
    socket.on('wiki-updated', handler);
    return () => socket.off('wiki-updated', handler);
  }, [socket]);

  const fetchPages = async () => {
    const res = await apiGet(`/wiki/session/${sessionId}`);
    if (res.ok) { const data = await res.json(); setPages(data); }
  };

  const createPage = async () => {
    if (!newTitle.trim()) return;
    const res = await apiPost('/wiki', { session_id: sessionId, title: newTitle, category: newCat, content: '' });
    if (res.ok) { const page = await res.json(); setNewTitle(''); fetchPages(); setSelectedCat(newCat); setSelectedPage(page); setEditing(true); setEditContent(''); }
  };

  const savePage = async () => {
    if (!selectedPage) return;
    const res = await apiPut(`/wiki/${selectedPage.id}`, { content: editContent });
    if (res.ok) { const updated = await res.json(); setSelectedPage(updated); setEditing(false); fetchPages(); }
  };

  const deletePage = async (id) => {
    const res = await apiDelete(`/wiki/${id}`);
    if (res.ok) { if (selectedPage?.id === id) { setSelectedPage(null); setEditing(false); } fetchPages(); }
  };

  const catPages = pages.filter(p => p.category === selectedCat);

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' }}>
      {/* ---- Sidebar ---- */}
      <div style={{
        width: 220, flexShrink: 0, background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto'
      }}>
        {/* Categories */}
        <div style={{ padding: '8px 6px' }}>
          {CATEGORIES.map(cat => (
            <button key={cat.id}
              onClick={() => { setSelectedCat(cat.id); setSelectedPage(null); setEditing(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                background: selectedCat === cat.id ? 'var(--accent-primary)' : 'transparent',
                color: selectedCat === cat.id ? '#1a1a2e' : 'var(--text-primary)',
                border: 'none', cursor: 'pointer', fontWeight: selectedCat === cat.id ? 700 : 400,
                fontSize: '0.88rem', marginBottom: '2px', textAlign: 'left'
              }}
            >
              {cat.icon} {cat.id}
            </button>
          ))}
        </div>

        {/* Page list for selected category */}
        <div style={{ borderTop: '1px solid var(--border-color)', flex: 1, padding: '6px' }}>
          {catPages.length === 0 ? (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '8px', textAlign: 'center' }}>Aucune page</p>
          ) : catPages.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
              <button
                onClick={() => { setSelectedPage(p); setEditing(false); setEditContent(p.content || ''); }}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                  background: selectedPage?.id === p.id ? 'rgba(201,168,76,0.15)' : 'transparent',
                  color: selectedPage?.id === p.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  fontSize: '0.82rem', textAlign: 'left', fontWeight: selectedPage?.id === p.id ? 600 : 400,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                📝 {p.title}
              </button>
              {isDM && (
                <button onClick={() => deletePage(p.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px', flexShrink: 0 }}>✕</button>
              )}
            </div>
          ))}
        </div>

        {/* Create page form (DM only) */}
        {isDM && (
          <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '5px' }}>+ Nouvelle Page</div>
            <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)}
              placeholder="Titre..." onKeyDown={e => e.key === 'Enter' && createPage()}
              style={{ width: '100%', padding: '4px 7px', fontSize: '0.8rem', marginBottom: '5px', boxSizing: 'border-box' }} />
            <select value={newCat} onChange={e => setNewCat(e.target.value)}
              style={{ width: '100%', padding: '4px 7px', fontSize: '0.8rem', marginBottom: '5px' }}>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.id}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={createPage} disabled={!newTitle.trim()} style={{ width: '100%' }}>Créer</button>
          </div>
        )}
      </div>

      {/* ---- Page content ---- */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedPage ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', background: 'var(--bg-primary)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '8px' }}>📖</div>
              <p>Aucune page sélectionnée</p>
              {isDM && <p style={{ fontSize: '0.82rem' }}>Créez une page dans la barre latérale.</p>}
            </div>
          </div>
        ) : (
          <>
            {/* Page header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)', flexShrink: 0
            }}>
              <div>
                <h2 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: '1.1rem', color: 'var(--accent-primary)' }}>{selectedPage.title}</h2>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedPage.category}</span>
              </div>
              {isDM && !editing && (
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setEditContent(selectedPage.content || ''); }}>✏️ Modifier</button>
              )}
              {isDM && editing && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="btn btn-primary btn-sm" onClick={savePage}>💾 Sauvegarder</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Annuler</button>
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {editing ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  placeholder="Écrivez le contenu de la page ici..."
                  style={{
                    flex: 1, padding: '16px', background: 'var(--bg-primary)', border: 'none', outline: 'none',
                    color: 'var(--text-primary)', fontSize: '0.9rem', resize: 'none', lineHeight: 1.6,
                    fontFamily: 'inherit'
                  }}
                />
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {selectedPage.content ? (
                    <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.7 }}>
                      {selectedPage.content}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {isDM ? 'Cliquez sur "Modifier" pour ajouter du contenu.' : 'Aucun contenu pour l\'instant.'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
