import { useState, useEffect } from 'react';
import { apiGet } from '../api/client';
import { useSocket } from '../contexts/SocketContext';
import { formatDate } from '../utils/date';

export default function ActionLog({ sessionId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // Chargement unique au montage — pas de polling ni de bouton Rafraîchir
    fetchLogs();
  }, [sessionId]);

  // Refetch des logs quand un pseudo change — les descriptions en DB sont mises à jour côté serveur
  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchLogs();
    socket.on('username-updated', handler);
    return () => socket.off('username-updated', handler);
  }, [socket, sessionId]);

  const fetchLogs = async () => {
    const res = await apiGet(`/logs/${sessionId}`);
    if (res.ok) setLogs(await res.json());
  };

  const getIcon = (type) => {
    switch (type) {
      case 'dice': return '🎲';
      case 'combat': return '⚔️';
      case 'session': return '📋';
      case 'character': return '📜';
      default: return '📝';
    }
  };

  const formatTime = (ts) => formatDate(ts);

  return (
    <div className="animate-fade-in">
      <div className="panel">
        <div className="panel-header">
          <h3>📋 Journal d'actions</h3>
        </div>
        <div style={{ maxHeight: '500px', overflowY: 'auto', padding: 'var(--space-sm)' }}>
          {logs.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)' }}>
              Aucune action enregistrée
            </p>
          ) : (
            logs.map(log => (
              <div key={log.id} style={{
                display: 'flex',
                gap: 'var(--space-sm)',
                padding: '6px var(--space-sm)',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '0.83rem'
              }}>
                <span>{getIcon(log.action_type)}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text-primary)' }}>{log.description}</span>
                </div>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                  {formatTime(log.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
