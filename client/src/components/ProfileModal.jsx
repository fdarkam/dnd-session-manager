import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function ProfileModal({ onClose }) {
  const { user, updateProfile, updatePassword } = useAuth();

  const [username, setUsername] = useState(user?.username || '');
  const [profileMsg, setProfileMsg] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  const saveUsername = async (e) => {
    e.preventDefault();
    setProfileMsg('');
    if (username.trim() === user.username) {
      setProfileMsg('ℹ️ Aucun changement');
      return;
    }
    setProfileSaving(true);
    try {
      await updateProfile(username.trim());
      setProfileMsg('✅ Pseudo mis à jour !');
    } catch (err) {
      setProfileMsg('❌ ' + err.message);
    } finally {
      setProfileSaving(false);
      setTimeout(() => setProfileMsg(''), 4000);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwdMsg('');
    if (newPwd !== confirmPwd) {
      setPwdMsg('❌ Les mots de passe ne correspondent pas');
      return;
    }
    if (newPwd.length < 4) {
      setPwdMsg('❌ Au moins 4 caractères requis');
      return;
    }
    setPwdSaving(true);
    try {
      await updatePassword(currentPwd, newPwd);
      setPwdMsg('✅ Mot de passe changé !');
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err) {
      setPwdMsg('❌ ' + err.message);
    } finally {
      setPwdSaving(false);
      setTimeout(() => setPwdMsg(''), 4000);
    }
  };

  const msgStyle = (msg) => ({
    fontSize: '0.82rem',
    marginTop: '6px',
    color: msg.startsWith('❌') ? 'var(--accent-danger)' : msg.startsWith('✅') ? 'var(--accent-success)' : 'var(--text-muted)',
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        className="card animate-slide-up"
        style={{ width: '100%', maxWidth: '420px', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)', fontSize: '1.1rem' }}>
            👤 Mon Profil
          </h3>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>✕</button>
        </div>

        {/* Username */}
        <form onSubmit={saveUsername} style={{ marginBottom: 'var(--space-xl)' }}>
          <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>
            Modifier le pseudo
          </h4>
          <div className="form-group" style={{ marginBottom: 'var(--space-sm)' }}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              required
              placeholder="Nouveau pseudo"
              autoComplete="username"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={profileSaving}>
            {profileSaving ? '...' : 'Enregistrer'}
          </button>
          {profileMsg && <div style={msgStyle(profileMsg)}>{profileMsg}</div>}
        </form>

        <div style={{ borderTop: '1px solid var(--border-color)', marginBottom: 'var(--space-xl)' }} />

        {/* Password */}
        <form onSubmit={savePassword}>
          <h4 style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)', fontWeight: 600 }}>
            Changer le mot de passe
          </h4>
          <div className="form-group">
            <label>Mot de passe actuel</label>
            <input
              type="password"
              value={currentPwd}
              onChange={(e) => setCurrentPwd(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          <div className="form-group">
            <label>Nouveau mot de passe</label>
            <input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              minLength={4}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label>Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pwdSaving}>
            {pwdSaving ? '...' : 'Changer le mot de passe'}
          </button>
          {pwdMsg && <div style={msgStyle(pwdMsg)}>{pwdMsg}</div>}
        </form>
      </div>
    </div>
  );
}
