import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';

let _notifCounter = 0;
const notifId = () => `${Date.now()}_${++_notifCounter}`;

export default function Notifications() {
  const socket = useSocket();
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onNotification = (data) => {
      const id = notifId();
      setToasts(prev => [...prev, { ...data, id }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    };

    const onUserJoined = (data) => {
      onNotification({ type: 'info', message: `${data.username} a rejoint la session` });
    };

    const onUserLeft = (data) => {
      onNotification({ type: 'info', message: `${data.username} a quitté la session` });
    };

    const onDiceResult = (data) => {
      const results = typeof data.results === 'string' ? JSON.parse(data.results) : data.results;
      const isNat20 = /^1d20$/i.test((data.expression || '').trim()) && results[0] === 20;
      const isNat1  = /^1d20$/i.test((data.expression || '').trim()) && results[0] === 1;
      const icon = isNat20 ? '🎉' : isNat1 ? '💀' : '🎲';
      const id = notifId();
      setToasts(prev => [...prev, {
        id, icon,
        type: isNat20 ? 'success' : isNat1 ? 'danger' : 'dice',
        message: `${data.username} : ${data.expression} → ${data.total}`,
        suffix: isNat20 ? ' NAT 20!' : isNat1 ? ' NAT 1!' : '',
      }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 1500);
    };

    socket.on('notification', onNotification);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('dice-result', onDiceResult);

    return () => {
      socket.off('notification', onNotification);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('dice-result', onDiceResult);
    };
  }, [socket]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type || 'info'}`}
          onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
          style={toast.type === 'dice' || toast.type === 'success' || toast.type === 'danger' ? {
            background: toast.type === 'success' ? 'rgba(34,197,94,0.15)' : toast.type === 'danger' ? 'rgba(239,68,68,0.15)' : undefined,
            borderColor: toast.type === 'success' ? 'var(--accent-success)' : toast.type === 'danger' ? 'var(--accent-danger)' : undefined,
          } : undefined}
        >
          <span style={{ fontSize: '1.1rem' }}>
            {toast.icon || (toast.type === 'turn' ? '⚔️' : 'ℹ️')}
          </span>
          <span style={{ fontSize: '0.85rem' }}>
            {toast.message}
            {toast.suffix && <strong style={{ marginLeft: 4 }}>{toast.suffix}</strong>}
          </span>
        </div>
      ))}
    </div>
  );
}
