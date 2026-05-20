import { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import SessionPage from './pages/SessionPage';
import './index.css';

function AppContent() {
  const { user, loading } = useAuth();
  const [currentSession, setCurrentSession] = useState(null);

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', animation: 'pulse 1.5s ease-in-out infinite' }}>🐉</div>
          <p style={{
            fontFamily: 'var(--font-heading)',
            color: 'var(--accent-primary)',
            marginTop: 'var(--space-md)',
            fontSize: '1.2rem'
          }}>
            Chargement...
          </p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;

  if (currentSession) {
    return <SessionPage sessionId={currentSession} onBack={() => setCurrentSession(null)} />;
  }

  return <DashboardPage onJoinSession={(id) => setCurrentSession(id)} />;
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <AppContent />
      </SocketProvider>
    </AuthProvider>
  );
}
