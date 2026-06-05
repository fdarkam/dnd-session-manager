import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';
import { parseDice, rollFromExpr } from '../utils/dice';

// Props :
//   sessionId   — id de la session courante
//   isDM        — true si l'utilisateur connecté est MJ
//   members     — tableau { id, username, role } des membres de la session
//   onlineUsers — Set<userId> des utilisateurs actuellement connectés (géré par SessionPage)
export default function ChatPanel({ sessionId, isDM = false, members = [], onlineUsers = new Set() }) {
  const socket = useSocket();
  const { user, token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  // Destinataire du message privé ('' = message public, MJ uniquement)
  const [targetUserId, setTargetUserId] = useState('');
  const bottomRef = useRef(null);

  // Chargement de l'historique au montage
  useEffect(() => {
    fetch(`${API}/chat/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setMessages(data));
  }, [sessionId]);

  // Réception de nouveaux messages via socket
  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => setMessages(prev => [...prev, msg]);
    socket.on('chat-message', handler);
    return () => socket.off('chat-message', handler);
  }, [socket]);

  // Rechargement de l'historique après reconnexion (messages manqués pendant la coupure)
  useEffect(() => {
    if (!socket) return;
    const aDejaConnecte = { current: socket.connected };
    const onConnect = () => {
      if (aDejaConnecte.current) {
        fetch(`${API}/chat/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data) setMessages(data); });
      }
      aDejaConnecte.current = true;
    };
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [socket, sessionId, token]);

  // Scroll automatique vers le dernier message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;

    // Commande /roll — interceptée et convertie en lancer de dés sans passer par le chat
    if (input.trim().toLowerCase().startsWith('/roll')) {
      const expr = input.trim().slice(5).trim(); // supprimer "/roll "
      if (parseDice(expr)) {
        const roll = rollFromExpr(expr);
        socket.emit('dice-roll', {
          sessionId,
          expression: roll.expression,
          results: roll.results,
          total: roll.total,
        });
        setInput('');
        return;
      }
      // Expression invalide : laisser passer comme message texte normal
    }

    // Message standard ou privé (destinataire uniquement accessible au MJ)
    socket.emit('chat-message', {
      sessionId,
      content: input.trim(),
      targetUserId: isDM && targetUserId ? targetUserId : undefined,
    });
    setInput('');
  };

  const formatTime = (ts) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // Nom d'un membre à partir de son id (pour afficher le destinataire d'un message privé)
  const getMemberName = (userId) => members.find(m => m.id === userId)?.username || 'Joueur';

  // Joueurs disponibles pour l'envoi de messages privés (le MJ ne se cible pas lui-même)
  const targetablePlayers = members.filter(m => m.id !== user.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* ─── En-tête ─────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <h3>💬 Chat</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{messages.length} msgs</span>
      </div>

      {/* ─── Présence des membres ─────────────────────────────── */}
      {/* Indicateur vert/gris pour chaque membre de la session */}
      {members.length > 0 && (
        <div style={{
          padding: '6px var(--space-sm)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          background: 'var(--bg-secondary)',
          flexShrink: 0,
        }}>
          {members.map(m => {
            const isOnline = onlineUsers.has(m.id);
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title={isOnline ? 'En ligne' : 'Hors ligne'}>
                {/* Point de présence : vert = en ligne, gris = hors ligne */}
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: isOnline ? '#22c55e' : 'var(--text-muted)',
                  boxShadow: isOnline ? '0 0 4px #22c55e88' : 'none',
                }} />
                <span style={{
                  fontSize: '0.72rem',
                  color: isOnline ? 'var(--text-primary)' : 'var(--text-muted)',
                  maxWidth: 72,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {m.username}{m.role === 'dm' ? ' 👑' : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Liste des messages ────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 'var(--space-sm)',
        display: 'flex', flexDirection: 'column', gap: '2px',
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)', fontSize: '0.85rem' }}>
            Aucun message. Commencez la discussion ! 🎭
          </div>
        )}
        {messages.map((msg, i) => {
          const isOwn    = msg.user_id === user.id;
          const isPrivate = !!msg.target_user_id;
          // Afficher le nom uniquement quand l'auteur ou le contexte privé change
          const showName = i === 0
            || messages[i - 1]?.user_id !== msg.user_id
            || messages[i - 1]?.target_user_id !== msg.target_user_id;

          return (
            <div key={msg.id || i} style={{
              padding: '4px var(--space-sm)',
              borderRadius: 'var(--radius-sm)',
              // Messages privés : fond violet discret pour les distinguer visuellement
              background: isPrivate
                ? 'rgba(139,92,246,0.08)'
                : isOwn ? 'rgba(201,168,76,0.05)' : 'transparent',
              border: isPrivate ? '1px solid rgba(139,92,246,0.2)' : '1px solid transparent',
            }}>
              {showName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: isOwn ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>
                    {msg.username}
                  </span>
                  {/* Badge "Message privé du MJ" visible côté expéditeur et destinataire */}
                  {isPrivate && (
                    <span style={{
                      fontSize: '0.62rem', padding: '1px 6px', borderRadius: 10,
                      background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
                      border: '1px solid rgba(139,92,246,0.3)',
                      whiteSpace: 'nowrap',
                    }}>
                      🔒 privé {isOwn ? `→ ${getMemberName(msg.target_user_id)}` : '(MJ)'}
                    </span>
                  )}
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                    {formatTime(msg.created_at)}
                  </span>
                </div>
              )}
              <p style={{ fontSize: '0.85rem', lineHeight: 1.4, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                {msg.content}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* ─── Sélecteur de destinataire — MJ uniquement ────────── */}
      {isDM && targetablePlayers.length > 0 && (
        <div style={{
          padding: '4px var(--space-sm)',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          display: 'flex', alignItems: 'center', gap: 'var(--space-xs)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Dest. :</span>
          <select
            value={targetUserId}
            onChange={(e) => setTargetUserId(e.target.value)}
            style={{
              flex: 1, fontSize: '0.8rem', padding: '3px 6px',
              background: 'var(--bg-secondary)', color: 'var(--text-primary)',
              border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
            }}
          >
            <option value="">📢 Message public</option>
            {targetablePlayers.map(m => (
              <option key={m.id} value={m.id}>🔒 {m.username} (privé)</option>
            ))}
          </select>
        </div>
      )}

      {/* ─── Formulaire d'envoi ────────────────────────────────── */}
      <form onSubmit={sendMessage} style={{
        display: 'flex', gap: 'var(--space-xs)', padding: 'var(--space-sm)',
        borderTop: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', flexShrink: 0,
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isDM && targetUserId
              ? `Message privé → ${getMemberName(targetUserId)}…`
              : '/roll 1d20+3  ou  message…'
          }
          style={{ flex: 1, fontSize: '0.85rem', padding: '8px 12px' }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!input.trim()}>➤</button>
      </form>
    </div>
  );
}
