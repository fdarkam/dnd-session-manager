import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';

// ─── Configuration des sons — fichiers dans client/public/sounds/ ─────────────
//     Laisser vide ('') pour utiliser le son procédural généré automatiquement.
const SOUND_FILES = {
  nat20: '/sounds/success.mp3',
  nat1: '/sounds/fart.mp3',
  roll: '/sounds/roll_dice.mp3',
};

// ─── Sons procéduraux (fallback si le fichier est absent ou vide) ─────────────
function _proceduralNat20(ctx) {
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.13;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.22);
    osc.start(t); osc.stop(t + 0.25);
  });
}
function _proceduralNat1(ctx) {
  const osc = ctx.createOscillator(); const g = ctx.createGain(); const filter = ctx.createBiquadFilter();
  osc.connect(filter); filter.connect(g); g.connect(ctx.destination);
  osc.type = 'sawtooth'; filter.type = 'lowpass'; filter.frequency.value = 700;
  osc.frequency.setValueAtTime(360, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.9);
  g.gain.setValueAtTime(0.22, ctx.currentTime); g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.9);
  osc.start(); osc.stop(ctx.currentTime + 0.9);
}
function _proceduralRoll(ctx) {
  const len = Math.floor(ctx.sampleRate * 0.16);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain(); g.gain.value = 0.2;
  src.connect(g); g.connect(ctx.destination); src.start();
}
const PROCEDURAL = { nat20: _proceduralNat20, nat1: _proceduralNat1, roll: _proceduralRoll };

let _notifCounter = 0;
const notifId = () => `${Date.now()}_${++_notifCounter}`;

export default function Notifications() {
  const socket = useSocket();
  const [toasts, setToasts] = useState([]);
  // AudioContext partagé pour toute la durée de vie du composant (toujours monté dans SessionPage)
  const audioCtxRef = useRef(null);

  // Récupère ou crée l'AudioContext, le reprend s'il est suspendu (politique autoplay navigateur)
  const getAudioCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  // Joue le son correspondant au résultat du lancer (nat20, nat1, ou lancer normal)
  const playDiceSound = (roll) => {
    try {
      const results = typeof roll.results === 'string' ? JSON.parse(roll.results) : roll.results;
      const isD20 = /^1d20$/i.test((roll.expression || '').trim());
      const key = isD20 && results[0] === 20 ? 'nat20' : isD20 && results[0] === 1 ? 'nat1' : 'roll';
      const src = SOUND_FILES[key];
      if (src) {
        // Tente le fichier audio — si absent/bloqué, bascule sur le son procédural
        const a = new Audio(src);
        a.volume = 0.75;
        a.play().catch(() => { try { PROCEDURAL[key](getAudioCtx()); } catch { } });
      } else {
        PROCEDURAL[key](getAudioCtx());
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!socket) return;

    const onNotification = (data) => {
      const id = notifId();
      setToasts(prev => [...prev, { ...data, id }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    };

    // Stocker userId + action pour pouvoir mettre à jour le message si le pseudo change pendant l'affichage
    const onUserJoined = (data) => {
      const id = notifId();
      setToasts(prev => [...prev, { id, type: 'info', userId: data.id, action: 'joined', message: `${data.username} a rejoint la session` }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    const onUserLeft = (data) => {
      const id = notifId();
      setToasts(prev => [...prev, { id, type: 'info', userId: data.id, action: 'left', message: `${data.username} a quitté la session` }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    // Mise à jour des toasts user-joined/user-left encore visibles si le pseudo change
    const onUsernameUpdated = ({ userId, newUsername }) => {
      setToasts(prev => prev.map(t => {
        if (t.userId !== userId) return t;
        if (t.action === 'joined') return { ...t, message: `${newUsername} a rejoint la session` };
        if (t.action === 'left') return { ...t, message: `${newUsername} a quitté la session` };
        return t;
      }));
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

    // Listener dédié au son — séparé du listener de toast pour garder les responsabilités distinctes.
    // Notifications est toujours monté dans SessionPage, donc ce listener est actif
    // même quand le panneau Dés est fermé (contrairement à l'ancien listener dans DiceRoller).
    const onDiceResultSound = (data) => {
      playDiceSound(data);
    };

    socket.on('notification', onNotification);
    socket.on('user-joined', onUserJoined);
    socket.on('user-left', onUserLeft);
    socket.on('username-updated', onUsernameUpdated);
    socket.on('dice-result', onDiceResult);
    socket.on('dice-result', onDiceResultSound);

    return () => {
      socket.off('notification', onNotification);
      socket.off('user-joined', onUserJoined);
      socket.off('user-left', onUserLeft);
      socket.off('username-updated', onUsernameUpdated);
      socket.off('dice-result', onDiceResult);
      socket.off('dice-result', onDiceResultSound);
    };
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

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
