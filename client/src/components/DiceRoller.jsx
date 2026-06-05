import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';

// ─── Sound configuration — placez vos fichiers dans client/public/sounds/ ────
//     Laissez vide ('') pour utiliser le son procédural généré automatiquement.
const SOUND_FILES = {
  nat20: '/sounds/nat20.mp3',   // ex: fanfare.mp3
  nat1:  '/sounds/nat1.mp3',    // ex: fail.mp3
  roll:  '/sounds/roll.mp3',    // ex: dice_roll.mp3
};

// ─── Web Audio fallback (si le fichier est absent ou vide) ───────────────────
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

export default function DiceRoller({ sessionId }) {
  const socket = useSocket();
  const { user, token } = useAuth();
  const storageKey = `dice_expr_${sessionId}`;
  const [expression, setExpression] = useState(() => sessionStorage.getItem(storageKey) || '1d20');
  const [history, setHistory] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [rolling, setRolling] = useState(false);
  const historyRef  = useRef(null);
  const audioCtxRef = useRef(null);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const playDiceSound = (roll) => {
    try {
      const results = typeof roll.results === 'string' ? JSON.parse(roll.results) : roll.results;
      const isD20   = /^1d20$/i.test((roll.expression || '').trim());
      const key     = isD20 && results[0] === 20 ? 'nat20' : isD20 && results[0] === 1 ? 'nat1' : 'roll';
      const src     = SOUND_FILES[key];
      if (src) {
        // Tente le fichier audio — si absent/bloqué, bascule sur le son procédural
        const a = new Audio(src);
        a.volume = 0.75;
        a.play().catch(() => { try { PROCEDURAL[key](getAudioCtx()); } catch {} });
      } else {
        PROCEDURAL[key](getAudioCtx());
      }
    } catch { /* ignore */ }
  };

  const setExpressionPersisted = (val) => { setExpression(val); sessionStorage.setItem(storageKey, val); };

  useEffect(() => {
    // Fetch history
    fetch(`${API}/dice/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.ok ? r.json() : [])
      .then(data => setHistory(data));
  }, [sessionId]);

  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      const roll = {
        ...data,
        results: typeof data.results === 'string' ? JSON.parse(data.results) : data.results
      };
      setHistory(prev => [roll, ...prev]);
      setLastResult(roll);
      playDiceSound(roll);
      setTimeout(() => {
        if (historyRef.current) historyRef.current.scrollTop = 0;
      }, 50);
    };
    socket.on('dice-result', handler);
    return () => socket.off('dice-result', handler);
  }, [socket]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseDice = (expr) => {
    // Parse format: NdX+M or NdX-M or NdX
    const match = expr.trim().match(/^(\d+)?d(\d+)([+-]\d+)?$/i);
    if (!match) return null;
    return {
      count: parseInt(match[1]) || 1,
      sides: parseInt(match[2]),
      modifier: parseInt(match[3]) || 0
    };
  };

  const rollDice = () => {
    const parsed = parseDice(expression);
    if (!parsed) return;

    setRolling(true);
    setTimeout(() => {
      const results = [];
      for (let i = 0; i < parsed.count; i++) {
        results.push(Math.floor(Math.random() * parsed.sides) + 1);
      }
      const sum = results.reduce((a, b) => a + b, 0);
      const total = sum + parsed.modifier;

      if (socket) {
        socket.emit('dice-roll', {
          sessionId,
          expression,
          results,
          total
        });
      }

      setRolling(false);
    }, 600);
  };

  const quickDice = [
    { label: 'd4', value: '1d4' },
    { label: 'd6', value: '1d6' },
    { label: 'd8', value: '1d8' },
    { label: 'd10', value: '1d10' },
    { label: 'd12', value: '1d12' },
    { label: 'd20', value: '1d20' },
    { label: 'd100', value: '1d100' },
    { label: '2d6', value: '2d6' },
    { label: '3d6', value: '3d6' },
    { label: '4d6', value: '4d6' },
  ];

  const isNat20 = lastResult && lastResult.expression.match(/1d20/i) && lastResult.results[0] === 20;
  const isNat1 = lastResult && lastResult.expression.match(/1d20/i) && lastResult.results[0] === 1;

  return (
    <div className="animate-fade-in">
      {/* Last Result — always on top */}
      {lastResult && (
        <div className="card" style={{
          textAlign: 'center',
          marginBottom: 'var(--space-md)',
          padding: 'var(--space-lg)',
          background: isNat20 ? 'rgba(34,197,94,0.08)' : isNat1 ? 'rgba(239,68,68,0.08)' : undefined,
          borderColor: isNat20 ? 'var(--accent-success)' : isNat1 ? 'var(--accent-danger)' : undefined
        }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
            {lastResult.username} lance {lastResult.expression}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
            {lastResult.results.map((r, i) => (
              <div key={i} className={`dice-result ${rolling ? 'animate-dice-roll' : 'animate-bounce-in'}`}>
                {r}
              </div>
            ))}
          </div>
          <div style={{
            fontSize: '2rem',
            fontWeight: 900,
            fontFamily: 'var(--font-heading)',
            color: isNat20 ? 'var(--accent-success)' : isNat1 ? 'var(--accent-danger)' : 'var(--accent-primary)'
          }}>
            {lastResult.total}
            {isNat20 && <span style={{ fontSize: '1rem', marginLeft: '8px' }}>🎉 NAT 20!</span>}
            {isNat1 && <span style={{ fontSize: '1rem', marginLeft: '8px' }}>💀 NAT 1!</span>}
          </div>
        </div>
      )}

      {/* Dice Input */}
      <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
          <input
            type="text"
            value={expression}
            onChange={(e) => setExpressionPersisted(e.target.value)}
            placeholder="1d20, 3d6+2, 1d100..."
            onKeyDown={(e) => e.key === 'Enter' && rollDice()}
            style={{ flex: 1, fontSize: '1.1rem', fontWeight: 600, textAlign: 'center' }}
          />
          <button
            className="btn btn-primary btn-lg"
            onClick={rollDice}
            disabled={rolling || !parseDice(expression)}
            style={{ minWidth: '120px' }}
          >
            {rolling ? '🎲...' : '🎲 Lancer!'}
          </button>
        </div>

        {/* Quick Dice Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {quickDice.map(d => (
            <button
              key={d.value}
              className={`btn btn-sm ${expression === d.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setExpressionPersisted(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="panel">
        <div className="panel-header">
          <h3>📜 Historique des lancers</h3>
        </div>
        <div
          ref={historyRef}
          style={{ maxHeight: '102px', overflowY: 'auto', padding: 'var(--space-sm)' }}
        >
          {history.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-lg)' }}>
              Aucun lancer encore...
            </p>
          ) : (
            history.map((roll, i) => (
              <div
                key={roll.id || i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px var(--space-sm)',
                  borderBottom: '1px solid var(--border-color)',
                  fontSize: '0.85rem'
                }}
              >
                <div>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{roll.username}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{roll.expression}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    [{(typeof roll.results === 'string' ? JSON.parse(roll.results) : roll.results).join(', ')}]
                  </span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: '32px', textAlign: 'right' }}>
                    = {roll.total}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
