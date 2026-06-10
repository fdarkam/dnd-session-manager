import { createContext, useContext, useState, useEffect } from 'react';
import { apiGet, apiPut } from '../api/client';

const API = `${import.meta.env.VITE_API_URL}/api`;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('dnd-token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      apiGet('/auth/me')
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => { setUser(data); setLoading(false); })
        .catch(() => { logout(); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [token]);

  const login = async (username, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('dnd-token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const register = async (username, password) => {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('dnd-token', data.token);
    setToken(data.token);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('dnd-token');
    setToken(null);
    setUser(null);
  };

  const updateProfile = async (username) => {
    const res = await apiPut('/auth/profile', { username });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('dnd-token', data.token);
    setToken(data.token);
    setUser(prev => ({ ...prev, ...data.user }));
    return data;
  };

  const updatePassword = async (current, newPassword) => {
    const res = await apiPut('/auth/password', { current, newPassword });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  };

  // Mise à jour locale du pseudo sans appel API — appelée par SessionPage lors d'un username-updated socket.
  // Ne concerne que l'utilisateur connecté (userId === user.id).
  const patchUsername = (userId, newUsername) => {
    if (user?.id === userId) {
      setUser(prev => prev ? { ...prev, username: newUsername } : prev);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateProfile, updatePassword, patchUsername }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export { API };
