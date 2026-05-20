import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';

export default function CombatTracker({ sessionId, isDM }) {
  const socket = useSocket();
  const { token } = useAuth();
  const [encounter, setEncounter] = useState(null);
  const [newName, setNewName] = useState('');
  const [entityName, setEntityName] = useState('');
  const [entityInit, setEntityInit] = useState('');
  const [entityHP, setEntityHP] = useState('');
  const [entityType, setEntityType] = useState('player');

  useEffect(() => {
    fetchEncounter();
  }, [sessionId]);

  useEffect(() => {
    if (!socket) return;

    const onUpdated = (data) => setEncounter(data);
    const onTurnChanged = (data) => setEncounter(data);

    socket.on('combat-updated', onUpdated);
    socket.on('combat-turn-changed', onTurnChanged);
    return () => {
      socket.off('combat-updated', onUpdated);
      socket.off('combat-turn-changed', onTurnChanged);
    };
  }, [socket]);

  const fetchEncounter = async () => {
    const res = await fetch(`${API}/combat/session/${sessionId}/active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data) {
        data.entities = typeof data.entities === 'string' ? JSON.parse(data.entities) : data.entities;
      }
      setEncounter(data);
    }
  };

  const createEncounter = async () => {
    const res = await fetch(`${API}/combat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, name: newName || 'Combat' })
    });
    if (res.ok) {
      const data = await res.json();
      data.entities = typeof data.entities === 'string' ? JSON.parse(data.entities) : data.entities;
      setEncounter(data);
      setNewName('');
    }
  };

  const addEntity = () => {
    if (!entityName.trim() || !encounter) return;
    const entities = [...(encounter.entities || []), {
      name: entityName,
      initiative: parseInt(entityInit) || 0,
      hp: parseInt(entityHP) || 20,
      hp_max: parseInt(entityHP) || 20,
      type: entityType,
      id: Date.now().toString()
    }];
    entities.sort((a, b) => b.initiative - a.initiative);
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    setEntityName('');
    setEntityInit('');
    setEntityHP('');
  };

  const removeEntity = (id) => {
    if (!encounter) return;
    const entities = encounter.entities.filter(e => e.id !== id);
    let currentTurn = encounter.current_turn;
    if (currentTurn >= entities.length) currentTurn = 0;
    const updated = { ...encounter, entities, current_turn: currentTurn };
    setEncounter(updated);
    broadcastUpdate(updated);
  };

  const nextTurn = () => {
    if (!encounter || !encounter.entities.length) return;
    let next = (encounter.current_turn + 1) % encounter.entities.length;
    let round = encounter.round;
    if (next === 0) round++;
    const updated = { ...encounter, current_turn: next, round };
    setEncounter(updated);
    if (socket) socket.emit('combat-next-turn', { sessionId, encounter: updated });
    broadcastUpdate(updated);
  };

  const prevTurn = () => {
    if (!encounter || !encounter.entities.length) return;
    let prev = encounter.current_turn - 1;
    let round = encounter.round;
    if (prev < 0) { prev = encounter.entities.length - 1; round = Math.max(1, round - 1); }
    const updated = { ...encounter, current_turn: prev, round };
    setEncounter(updated);
    broadcastUpdate(updated);
  };

  const updateEntityHP = (id, delta) => {
    const entities = encounter.entities.map(e => {
      if (e.id === id) {
        return { ...e, hp: Math.max(0, Math.min(e.hp_max, e.hp + delta)) };
      }
      return e;
    });
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
  };

  const endCombat = async () => {
    if (!encounter) return;
    await fetch(`${API}/combat/${encounter.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: false })
    });
    setEncounter(null);
    if (socket) socket.emit('combat-update', { sessionId, encounter: null });
  };

  const broadcastUpdate = (enc) => {
    // Save to server
    fetch(`${API}/combat/${enc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        entities: enc.entities,
        current_turn: enc.current_turn,
        round: enc.round
      })
    });
    if (socket) socket.emit('combat-update', { sessionId, encounter: enc });
  };

  if (!encounter) {
    return (
      <div className="card animate-fade-in" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
        <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)' }}>⚔️</div>
        <h3 style={{ fontFamily: 'var(--font-heading)', marginBottom: 'var(--space-md)' }}>Aucun combat en cours</h3>
        {isDM && (
          <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'center', alignItems: 'center' }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nom du combat"
              style={{ maxWidth: '200px' }}
            />
            <button className="btn btn-primary" onClick={createEncounter}>
              ⚔️ Lancer un combat
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeEntity = encounter.entities[encounter.current_turn];

  return (
    <div className="animate-fade-in">
      {/* Combat Header */}
      <div className="card" style={{ marginBottom: 'var(--space-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)' }}>
            ⚔️ {encounter.name || 'Combat'}
          </h3>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Round {encounter.round} • {encounter.entities.length} entités
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          {isDM && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={prevTurn}>◀</button>
              <button className="btn btn-primary" onClick={nextTurn}>
                Tour suivant ▶
              </button>
              <button className="btn btn-danger btn-sm" onClick={endCombat}>
                Fin du combat
              </button>
            </>
          )}
        </div>
      </div>

      {/* Active Entity Banner */}
      {activeEntity && (
        <div className="card animate-glow" style={{
          marginBottom: 'var(--space-md)',
          textAlign: 'center',
          borderColor: 'var(--accent-primary)',
          background: 'rgba(201, 168, 76, 0.05)',
          padding: 'var(--space-sm) var(--space-md)'
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tour actif</span>
          <div style={{ fontSize: '1.3rem', fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)' }}>
            {activeEntity.type === 'enemy' ? '💀' : '🛡️'} {activeEntity.name}
          </div>
        </div>
      )}

      {/* Initiative List */}
      <div className="panel" style={{ marginBottom: 'var(--space-md)' }}>
        <div className="panel-header">
          <h3>📋 Ordre d'initiative</h3>
        </div>
        <div style={{ padding: 'var(--space-sm)' }}>
          {encounter.entities.map((entity, i) => {
            const isActive = i === encounter.current_turn;
            const hpPct = (entity.hp / Math.max(entity.hp_max, 1)) * 100;
            const hpClass = hpPct > 60 ? 'hp-high' : hpPct > 30 ? 'hp-mid' : 'hp-low';

            return (
              <div
                key={entity.id}
                className={`initiative-row ${isActive ? 'active' : ''}`}
                style={{ marginBottom: '4px' }}
              >
                <div className="turn-indicator" />
                <span style={{
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                  minWidth: '32px',
                  textAlign: 'center'
                }}>
                  {entity.initiative}
                </span>
                <span style={{ fontSize: '1.1rem' }}>
                  {entity.type === 'enemy' ? '💀' : '🛡️'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{entity.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginTop: '2px' }}>
                    <div className="hp-bar-container" style={{ width: '100px', height: '6px' }}>
                      <div className={`hp-bar ${hpClass}`} style={{ width: `${hpPct}%` }} />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {entity.hp}/{entity.hp_max}
                    </span>
                  </div>
                </div>
                {isDM && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => updateEntityHP(entity.id, -1)}>-1</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => updateEntityHP(entity.id, 1)}>+1</button>
                    <button className="btn-icon" onClick={() => removeEntity(entity.id)} style={{ fontSize: '0.8rem' }}>✕</button>
                  </div>
                )}
              </div>
            );
          })}
          {encounter.entities.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 'var(--space-md)' }}>
              Ajoutez des entités au combat
            </p>
          )}
        </div>
      </div>

      {/* Add Entity (DM only) */}
      {isDM && (
        <div className="card">
          <h4 style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 'var(--space-sm)' }}>
            + Ajouter une entité
          </h4>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '120px', marginBottom: 0 }}>
              <label>Nom</label>
              <input type="text" value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="Gobelin..." />
            </div>
            <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
              <label>Initiative</label>
              <input type="number" value={entityInit} onChange={(e) => setEntityInit(e.target.value)} placeholder="15" />
            </div>
            <div className="form-group" style={{ width: '80px', marginBottom: 0 }}>
              <label>PV</label>
              <input type="number" value={entityHP} onChange={(e) => setEntityHP(e.target.value)} placeholder="20" />
            </div>
            <div className="form-group" style={{ width: '120px', marginBottom: 0 }}>
              <label>Type</label>
              <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
                <option value="player">🛡️ Joueur</option>
                <option value="enemy">💀 Ennemi</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={addEntity} style={{ marginBottom: 0 }}>Ajouter</button>
          </div>
        </div>
      )}
    </div>
  );
}
