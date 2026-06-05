import { useState } from 'react';
import { useAuth, API } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [resetDmUser, setResetDmUser] = useState('');
  const [resetDmPwd, setResetDmPwd] = useState('');
  const [resetTarget, setResetTarget] = useState('');
  const [resetNewPwd, setResetNewPwd] = useState('');
  const [resetMsg, setResetMsg] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDmReset = async (e) => {
    e.preventDefault();
    setResetMsg('');
    setResetLoading(true);
    try {
      const res = await fetch(`${API}/auth/dm-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dmUsername: resetDmUser,
          dmPassword: resetDmPwd,
          targetUsername: resetTarget,
          newPassword: resetNewPwd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResetMsg('✅ Mot de passe réinitialisé ! Le joueur peut se reconnecter.');
      setResetDmUser(''); setResetDmPwd(''); setResetTarget(''); setResetNewPwd('');
    } catch (err) {
      setResetMsg('❌ ' + err.message);
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'var(--space-md)',
      background: `
        radial-gradient(ellipse at 30% 30%, rgba(201, 168, 76, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 70% 70%, rgba(139, 92, 246, 0.06) 0%, transparent 50%),
        var(--bg-primary)
      `
    }}>
      <div className="card animate-slide-up" style={{
        width: '100%',
        maxWidth: '420px',
        padding: 'var(--space-2xl)',
        border: '1px solid var(--border-color)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Decorative top border */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '3px',
          background: 'linear-gradient(90deg, transparent, var(--accent-primary), transparent)'
        }} />

        <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: 'var(--space-sm)',
            filter: 'drop-shadow(0 0 10px rgba(201, 168, 76, 0.3))'
          }}>🐉</div>
          <h1 style={{
            fontFamily: 'var(--font-heading)',
            fontSize: '1.8rem',
            background: 'linear-gradient(135deg, var(--accent-primary), #f0d78c)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: 'var(--space-xs)'
          }}>
            DND Manager
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Gérez vos aventures épiques
          </p>
        </div>

        <div className="tabs" style={{ marginBottom: 'var(--space-lg)' }}>
          <button
            className={`tab ${isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(true); setError(''); }}
          >
            ⚔️ Connexion
          </button>
          <button
            className={`tab ${!isLogin ? 'active' : ''}`}
            onClick={() => { setIsLogin(false); setError(''); }}
          >
            📜 Inscription
          </button>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--accent-danger)',
            fontSize: '0.85rem',
            marginBottom: 'var(--space-md)',
            animation: 'slideUp 0.2s ease'
          }}>
            {error}
          </div>
        )}

        {!showReset ? (
          <>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Pseudo</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Entrez votre pseudo"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Entrez votre mot de passe"
                  required
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg w-full"
                disabled={loading}
                style={{ marginTop: 'var(--space-sm)' }}
              >
                {loading ? '⏳' : isLogin ? '⚔️ Se connecter' : '📜 S\'inscrire'}
              </button>
            </form>
            {isLogin && (
              <div style={{ textAlign: 'center', marginTop: 'var(--space-md)' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.8rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => { setShowReset(true); setError(''); setResetMsg(''); }}
                >
                  🔑 Mot de passe oublié ?
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1rem', marginBottom: '6px' }}>
                🔑 Réinitialisation par le MJ
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Le Maître de Jeu entre ses identifiants pour définir un nouveau mot de passe à un joueur.
              </p>
            </div>
            {resetMsg && (
              <div style={{
                padding: '10px 14px',
                background: resetMsg.startsWith('❌') ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                border: `1px solid ${resetMsg.startsWith('❌') ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                borderRadius: 'var(--radius-sm)',
                color: resetMsg.startsWith('❌') ? 'var(--accent-danger)' : 'var(--accent-success)',
                fontSize: '0.85rem',
                marginBottom: 'var(--space-md)',
              }}>
                {resetMsg}
              </div>
            )}
            <form onSubmit={handleDmReset}>
              <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>Identifiants du MJ</p>
                <div className="form-group">
                  <label>Pseudo MJ</label>
                  <input type="text" value={resetDmUser} onChange={(e) => setResetDmUser(e.target.value)} required autoFocus autoComplete="username" />
                </div>
                <div className="form-group">
                  <label>Mot de passe MJ</label>
                  <input type="password" value={resetDmPwd} onChange={(e) => setResetDmPwd(e.target.value)} required autoComplete="current-password" />
                </div>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>Joueur à réinitialiser</p>
                <div className="form-group">
                  <label>Pseudo du joueur</label>
                  <input type="text" value={resetTarget} onChange={(e) => setResetTarget(e.target.value)} required autoComplete="off" />
                </div>
                <div className="form-group">
                  <label>Nouveau mot de passe</label>
                  <input type="password" value={resetNewPwd} onChange={(e) => setResetNewPwd(e.target.value)} minLength={4} required autoComplete="new-password" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                <button type="submit" className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={resetLoading}>
                  {resetLoading ? '⏳' : '🔑 Réinitialiser'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowReset(false); setResetMsg(''); }}>
                  Retour
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
