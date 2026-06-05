import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const currentSessionRef = useRef(null);

  useEffect(() => {
    if (!token) {
      if (socket) { socket.disconnect(); setSocket(null); }
      return;
    }
    const s = io(import.meta.env.VITE_API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });
    s.on('connect', () => {
      console.log('🔌 Socket connected');
      // Re-join session automatically after reconnect
      if (currentSessionRef.current) {
        s.emit('join-session', currentSessionRef.current);
      }
    });
    s.on('connect_error', (err) => console.error('Socket error:', err.message));
    setSocket(s);
    return () => { s.disconnect(); };
  }, [token]);

  return (
    <SocketContext.Provider value={{ socket, currentSessionRef }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  return ctx?.socket ?? null;
};

export const useSocketContext = () => useContext(SocketContext);
