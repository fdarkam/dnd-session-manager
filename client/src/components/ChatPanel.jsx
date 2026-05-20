import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';

export default function ChatPanel({ sessionId }) {
  const socket = useSocket();
  const { user, token } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    fetch(`${API}/chat/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setMessages(data));
  }, [sessionId]);

  useEffect(() => {
    if (!socket) return;
    const handler = (msg) => {
      setMessages(prev => [...prev, msg]);
    };
    socket.on('chat-message', handler);
    return () => socket.off('chat-message', handler);
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || !socket) return;
    socket.emit('chat-message', { sessionId, content: input.trim() });
    setInput('');
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <h3>💬 Chat</h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{messages.length} msgs</span>
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--space-sm)',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px'
      }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)', fontSize: '0.85rem' }}>
            Aucun message. Commencez la discussion ! 🎭
          </div>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.user_id === user.id;
          const showName = i === 0 || messages[i - 1]?.user_id !== msg.user_id;
          return (
            <div key={msg.id || i} style={{
              padding: '4px var(--space-sm)',
              borderRadius: 'var(--radius-sm)',
              background: isOwn ? 'rgba(201, 168, 76, 0.05)' : 'transparent',
            }}>
              {showName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <span style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: isOwn ? 'var(--accent-primary)' : 'var(--accent-secondary)'
                  }}>
                    {msg.username}
                  </span>
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

      <form onSubmit={sendMessage} style={{
        display: 'flex',
        gap: 'var(--space-xs)',
        padding: 'var(--space-sm)',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        flexShrink: 0
      }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Envoyer un message..."
          style={{ flex: 1, fontSize: '0.85rem', padding: '8px 12px' }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={!input.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
