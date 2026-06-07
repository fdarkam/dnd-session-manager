import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);
  const currentSessionRef = useRef(null);
  // Ref interne au socket — accès synchrone sans déclencher de re-renders
  const socketRef = useRef(null);
  // Ref du token courant — évite le stale closure lors de la création du socket
  const tokenRef = useRef(token);

  // Effet 1 — synchronisation du token dans la ref + mise à jour de l'auth du socket.
  // S'exécute à chaque changement de token (y compris lors d'un changement de pseudo).
  // Ne déconnecte PAS le socket : il suffit de mettre à jour socket.auth pour que
  // le nouveau JWT soit utilisé lors de la prochaine reconnexion automatique si nécessaire.
  useEffect(() => {
    tokenRef.current = token;
    if (token && socketRef.current) {
      socketRef.current.auth = { token };
    }
  }, [token]);

  // Effet 2 — cycle de vie du socket : création au login, destruction au logout.
  // Dépend de hasToken (booléen) et NON de la valeur exacte du token.
  // Conséquence : un changement de pseudo (qui re-émet un nouveau JWT) ne déclenche
  // pas cet effet → pas de déconnexion/reconnexion → pas de toasts user-left/user-joined parasites.
  const hasToken = !!token;
  useEffect(() => {
    if (!hasToken) {
      // Logout réel — on coupe le socket proprement
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      return;
    }

    // Socket déjà actif (peut arriver en React StrictMode double-mount) — ne pas recréer
    if (socketRef.current) return;

    const s = io(import.meta.env.VITE_API_URL, {
      auth: { token: tokenRef.current },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    s.on('connect', () => {
      console.log('🔌 Socket connected');
      // Re-join automatiquement la session après reconnexion réseau
      if (currentSessionRef.current) {
        s.emit('join-session', currentSessionRef.current);
      }
    });
    s.on('connect_error', (err) => console.error('Socket error:', err.message));

    socketRef.current = s;
    setSocket(s);

    return () => {
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [hasToken]); // Intentionnellement limité à hasToken — voir commentaire ci-dessus

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
