import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';

export default function Notifications() {
  const socket = useSocket();
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    if (!socket) return;

    const onNotification = (data) => {
      const id = Date.now();
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

    socket.on('notification', onNotification);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);

    return () => {
      socket.off('notification', onNotification);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
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
        >
          <span style={{ fontSize: '1.1rem' }}>
            {toast.type === 'turn' ? '⚔️' : 'ℹ️'}
          </span>
          <span style={{ fontSize: '0.85rem' }}>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
