import { useState, useEffect } from 'react';
import { useAuth, API } from '../contexts/AuthContext';
import { useSocket, useSocketContext } from '../contexts/SocketContext';
import CharacterSheet from '../components/CharacterSheet';
import ChatPanel from '../components/ChatPanel';
import MapCanvas from '../components/MapCanvas';
import ActionLog from '../components/ActionLog';
import Notifications from '../components/Notifications';
import QuestTracker from '../components/QuestTracker';
import WikiPanel from '../components/WikiPanel';

export default function SessionPage({ sessionId, onBack }) {
  const { user, token, logout } = useAuth();
  const socket = useSocket();
  const { currentSessionRef } = useSocketContext();
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState('characters');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession();
  }, [sessionId]);

  useEffect(() => {
    if (socket && sessionId) {
      currentSessionRef.current = sessionId;
      socket.emit('join-session', sessionId);
      return () => {
        currentSessionRef.current = null;
        socket.emit('leave-session', sessionId);
      };
    }
  }, [socket, sessionId]);

  const fetchSession = async () => {
    const res = await fetch(`${API}/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setSession(await res.json());
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', animation: 'pulse 1.5s ease-in-out infinite' }}>🐉</div>
          <p style={{ color: 'var(--text-muted)', marginTop: 'var(--space-md)' }}>Chargement...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p>Session introuvable</p>
          <button className="btn btn-primary mt-md" onClick={onBack}>Retour</button>
        </div>
      </div>
    );
  }

  const isDM = session.dm_id === user.id;

  const tabs = [
    { id: 'characters', icon: '📜', label: 'Personnages' },
    { id: 'quests', icon: '🎯', label: 'Quêtes' },
    { id: 'map', icon: '🗺️', label: 'Map' },
    { id: 'wiki', icon: '📖', label: 'Wiki' },
    { id: 'logs', icon: '📋', label: 'Logs' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Notifications />

      {/* Top Navigation */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-sm) var(--space-lg)',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <button className="btn btn-secondary btn-sm" onClick={onBack}>← Retour</button>
          <div>
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1rem', color: 'var(--accent-primary)' }}>
              {session.name}
            </h2>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span className={`badge ${isDM ? 'badge-dm' : 'badge-player'}`} style={{ fontSize: '0.65rem' }}>
                {isDM ? '👑 MJ' : '⚔️ Joueur'}
              </span>
              <span>👥 {session.members?.length || 0} membres</span>
              {isDM && (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigator.clipboard.writeText(session.invite_code)}
                  title="Copier le code d'invitation"
                >
                  🔗 {session.invite_code}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>⚔️ {user.username}</span>
          <button className="btn btn-secondary btn-sm" onClick={logout}>Décon.</button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="session-layout" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Tabs */}
        <div style={{
          gridColumn: '1',
          gridRow: '1',
          padding: 'var(--space-sm) var(--space-md) 0',
          background: 'var(--bg-primary)'
        }}>
          <div className="tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content — all tabs stay mounted to preserve state and socket listeners */}
        <div className="session-main">
          <div style={{ display: activeTab === 'characters' ? 'block' : 'none', height: '100%' }}>
            <CharacterSheet sessionId={sessionId} isDM={isDM} />
          </div>
          <div style={{ display: activeTab === 'quests' ? 'block' : 'none', height: '100%' }}>
            <QuestTracker sessionId={sessionId} isDM={isDM} />
          </div>
          <div style={{ display: activeTab === 'map' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
            <MapCanvas sessionId={sessionId} isDM={isDM} />
          </div>
          <div style={{ display: activeTab === 'wiki' ? 'flex' : 'none', height: '100%' }}>
            <WikiPanel sessionId={sessionId} isDM={isDM} />
          </div>
          <div style={{ display: activeTab === 'logs' ? 'block' : 'none', height: '100%' }}>
            <ActionLog sessionId={sessionId} />
          </div>
        </div>

        {/* Chat Sidebar */}
        <div className="session-sidebar">
          <ChatPanel sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
