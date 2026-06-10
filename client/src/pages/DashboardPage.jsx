import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiGet, apiPost, apiDelete } from '../api/client';
import ProfileModal from '../components/ProfileModal';

export default function DashboardPage({ onJoinSession }) {
  const { user, logout } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    const res = await apiGet('/sessions');
    if (res.ok) setSessions(await res.json());
  };

  const createSession = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiPost('/sessions', { name, description });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowCreate(false);
      setName('');
      setDescription('');
      fetchSessions();
    } catch (err) {
      setError(err.message);
    }
  };

  const joinSession = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiPost('/sessions/join', { code: joinCode });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowJoin(false);
      setJoinCode('');
      fetchSessions();
    } catch (err) {
      setError(err.message);
    }
  };

  const deleteSession = async (id) => {
    if (!confirm('Supprimer cette session ?')) return;
    await apiDelete(`/sessions/${id}`);
    fetchSessions();
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {/* Navbar */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-md) var(--space-xl)',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span style={{ fontSize: '1.5rem' }}>🐉</span>
          <h1 style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '1.2rem',
            color: 'var(--accent-primary)'
          }}>DND Manager</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            ⚔️ {user?.username}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowProfile(true)} title="Mon profil">👤 Profil</button>
          <button className="btn btn-secondary btn-sm" onClick={logout}>
            Déconnexion
          </button>
        </div>
      </nav>

      {/* Content */}
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: 'var(--space-xl)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-xl)',
          flexWrap: 'wrap',
          gap: 'var(--space-md)'
        }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.6rem', marginBottom: '4px' }}>
              Mes Campagnes
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Gérez vos sessions de jeu
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
            <button className="btn btn-primary" onClick={() => { setShowCreate(true); setShowJoin(false); }}>
              ✨ Créer une session
            </button>
            <button className="btn btn-secondary" onClick={() => { setShowJoin(true); setShowCreate(false); }}>
              🔗 Rejoindre
            </button>
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-danger)',
            fontSize: '0.85rem',
            marginBottom: 'var(--space-md)'
          }}>
            {error}
          </div>
        )}

        {/* Create Session Modal */}
        {showCreate && (
          <div className="card animate-slide-up" style={{ marginBottom: 'var(--space-lg)', borderColor: 'var(--accent-primary)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', marginBottom: 'var(--space-md)' }}>
              ✨ Nouvelle Session
            </h3>
            <form onSubmit={createSession}>
              <div className="form-group">
                <label>Nom de la campagne</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="La Malédiction de Strahd..."
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Description (optionnel)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Une brève description de l'aventure..."
                  rows={3}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-primary">Créer</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Annuler</button>
              </div>
            </form>
          </div>
        )}

        {/* Join Session */}
        {showJoin && (
          <div className="card animate-slide-up" style={{ marginBottom: 'var(--space-lg)', borderColor: 'var(--accent-secondary)' }}>
            <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-secondary)', marginBottom: 'var(--space-md)' }}>
              🔗 Rejoindre une session
            </h3>
            <form onSubmit={joinSession}>
              <div className="form-group">
                <label>Code d'invitation</label>
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  required
                  autoFocus
                  style={{ textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, fontSize: '1.2rem', textAlign: 'center' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-primary">Rejoindre</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowJoin(false)}>Annuler</button>
              </div>
            </form>
          </div>
        )}

        {/* Session List */}
        {sessions.length === 0 && !showCreate && !showJoin ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
            <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>🗺️</div>
            <h3 style={{ fontFamily: 'var(--font-heading)', marginBottom: 'var(--space-sm)' }}>
              Aucune campagne
            </h3>
            <p style={{ color: 'var(--text-muted)' }}>
              Créez une nouvelle session ou rejoignez-en une avec un code d'invitation
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
            {sessions.map(session => (
              <div
                key={session.id}
                className="card"
                style={{ cursor: 'pointer', transition: 'all var(--transition-normal)' }}
                onClick={() => onJoinSession(session.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-primary)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 4px 20px var(--accent-primary-glow)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
                      <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.1rem' }}>
                        {session.name}
                      </h3>
                      <span className={`badge ${session.dm_id === user.id ? 'badge-dm' : 'badge-player'}`}>
                        {session.dm_id === user.id ? '👑 MJ' : '⚔️ Joueur'}
                      </span>
                    </div>
                    {session.description && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-sm)' }}>
                        {session.description}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-lg)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      <span>👥 {session.member_count} membres</span>
                      <span>👑 MJ: {session.dm_name}</span>
                      {session.dm_id === user.id && (
                        <span
                          style={{ cursor: 'pointer', color: 'var(--text-muted)' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(session.invite_code);
                          }}
                          title="Copier le code"
                        >
                          🔗 Code: <strong style={{ color: 'var(--accent-primary)' }}>{session.invite_code}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                  {session.dm_id === user.id && (
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                      title="Supprimer"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
