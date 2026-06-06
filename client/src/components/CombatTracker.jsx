import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { useAuth, API } from '../contexts/AuthContext';

const ALL_STATUSES = [
  'Empoisonné', 'Étourdi', 'Concentré', 'Charmé', 'Effrayé',
  'Paralysé', 'Aveuglé', 'Sourd', 'Invisible', 'Prone',
  'Entravé', 'Épuisé', 'Pétrifié', 'Inconscient',
];

const STATUS_STYLE = {
  'Empoisonné':  { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e' },
  'Étourdi':     { bg: 'rgba(234,179,8,0.15)',    color: '#eab308' },
  'Concentré':   { bg: 'rgba(59,130,246,0.15)',   color: '#60a5fa' },
  'Charmé':      { bg: 'rgba(236,72,153,0.15)',   color: '#f472b6' },
  'Effrayé':     { bg: 'rgba(249,115,22,0.15)',   color: '#fb923c' },
  'Paralysé':    { bg: 'rgba(168,85,247,0.15)',   color: '#c084fc' },
  'Aveuglé':     { bg: 'rgba(107,114,128,0.15)',  color: '#9ca3af' },
  'Sourd':       { bg: 'rgba(107,114,128,0.15)',  color: '#9ca3af' },
  'Invisible':   { bg: 'rgba(139,92,246,0.12)',   color: '#a78bfa' },
  'Prone':       { bg: 'rgba(146,64,14,0.15)',    color: '#d97706' },
  'Entravé':     { bg: 'rgba(220,38,38,0.15)',    color: '#f87171' },
  'Épuisé':      { bg: 'rgba(120,113,108,0.15)',  color: '#a8a29e' },
  'Pétrifié':    { bg: 'rgba(55,65,81,0.2)',      color: '#9ca3af' },
  'Inconscient': { bg: 'rgba(15,23,42,0.4)',      color: '#94a3b8' },
};

export default function CombatTracker({ sessionId, isDM }) {
  const socket = useSocket();
  const { token, user } = useAuth();
  const [encounter, setEncounter] = useState(null);

  // Formulaire création combat (MJ)
  const [newName, setNewName] = useState('');

  // Formulaire ajout entité (MJ)
  const [entityName, setEntityName] = useState('');
  const [entityInit, setEntityInit] = useState('');
  const [entityHP, setEntityHP] = useState('');
  const [entityType, setEntityType] = useState('enemy');

  // Feature 1 — Rejoindre le combat (joueur)
  const [showJoin, setShowJoin] = useState(false);
  const [joinType, setJoinType] = useState('character');
  const [joinName, setJoinName] = useState('');
  const [joinInit, setJoinInit] = useState('');
  const [joinHp, setJoinHp] = useState('');
  const [myCharacter, setMyCharacter] = useState(null);

  // Feature 2 — input PV par entité (entityId → valeur saisie)
  const [hpDeltas, setHpDeltas] = useState({});

  // Feature 3 — sélecteur de statut (entityId ou null) + position viewport
  const [statusOpen, setStatusOpen] = useState(null);
  const [statusPickerPos, setStatusPickerPos] = useState({ left: 0, top: 0 });

  useEffect(() => { fetchEncounter(); }, [sessionId]);

  // Charger le personnage assigné au joueur pour le formulaire de jointure
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API}/characters/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (Array.isArray(data) && data.length > 0) setMyCharacter(data[0]); });
  }, [sessionId, token]);

  useEffect(() => {
    if (!socket) return;
    const normalize = (data) => {
      if (!data) return data;
      if (typeof data.entities === 'string') return { ...data, entities: JSON.parse(data.entities) };
      return data;
    };
    const onUpdated = (data) => setEncounter(normalize(data));
    const onTurnChanged = (data) => setEncounter(normalize(data));
    socket.on('combat-updated', onUpdated);
    socket.on('combat-turn-changed', onTurnChanged);
    return () => {
      socket.off('combat-updated', onUpdated);
      socket.off('combat-turn-changed', onTurnChanged);
    };
  }, [socket]);

  // Fermer le sélecteur de statut si on clique en dehors (position:fixed → pas dans le flow)
  useEffect(() => {
    if (!statusOpen) return;
    const handler = (e) => {
      if (!e.target.closest('[data-status-picker]')) setStatusOpen(null);
    };
    // Délai 0 pour ignorer le mousedown qui a ouvert le picker
    const id = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('mousedown', handler); };
  }, [statusOpen]);

  const fetchEncounter = async () => {
    const res = await fetch(`${API}/combat/session/${sessionId}/active`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.entities && typeof data.entities === 'string')
        data.entities = JSON.parse(data.entities);
      setEncounter(data);
    }
  };

  // Un joueur peut éditer uniquement ses propres entités ; le MJ peut tout éditer
  const canEditEntity = (entity) =>
    isDM || entity.addedBy === user?.id || entity.userId === user?.id;

  const broadcastUpdate = (enc) => {
    fetch(`${API}/combat/${enc.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ entities: enc.entities, current_turn: enc.current_turn, round: enc.round }),
    });
    if (socket) socket.emit('combat-update', { sessionId, encounter: enc });
  };

  const createEncounter = async () => {
    const res = await fetch(`${API}/combat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, name: newName || 'Combat' }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.entities && typeof data.entities === 'string') data.entities = JSON.parse(data.entities);
      setEncounter(data);
      setNewName('');
    }
  };

  // MJ : ajouter une entité au combat
  const addEntity = () => {
    if (!entityName.trim() || !encounter) return;
    const entities = [
      ...(encounter.entities || []),
      {
        id: Date.now().toString(),
        name: entityName,
        initiative: parseInt(entityInit) || 0,
        hp: parseInt(entityHP) || 20,
        hp_max: parseInt(entityHP) || 20,
        type: entityType,
        addedBy: user?.id,
        statuses: [],
      },
    ];
    entities.sort((a, b) => b.initiative - a.initiative);
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    setEntityName(''); setEntityInit(''); setEntityHP('');
  };

  // Feature 1 — Joueur rejoint le combat avec son personnage ou un compagnon
  const joinCombat = () => {
    if (!encounter) return;
    let newEntity;
    if (joinType === 'character' && myCharacter) {
      newEntity = {
        id: Date.now().toString(),
        name: myCharacter.name || 'Personnage',
        initiative: parseInt(joinInit) || 0,
        hp: myCharacter.hp_current ?? myCharacter.hp_max ?? 10,
        hp_max: myCharacter.hp_max ?? 10,
        type: 'player',
        userId: user?.id,
        characterId: myCharacter.id,
        addedBy: user?.id,
        statuses: [],
      };
    } else {
      if (!joinName.trim()) return;
      newEntity = {
        id: Date.now().toString(),
        name: joinName,
        initiative: parseInt(joinInit) || 0,
        hp: parseInt(joinHp) || 10,
        hp_max: parseInt(joinHp) || 10,
        type: 'npc',
        addedBy: user?.id,
        statuses: [],
      };
    }
    const entities = [...(encounter.entities || []), newEntity];
    entities.sort((a, b) => b.initiative - a.initiative);
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    setShowJoin(false);
    setJoinName(''); setJoinInit(''); setJoinHp('');
  };

  const removeEntity = (id) => {
    if (!encounter) return;
    const entity = encounter.entities.find(e => e.id === id);
    if (!entity || !canEditEntity(entity)) return;
    const entities = encounter.entities.filter(e => e.id !== id);
    const currentTurn = Math.min(encounter.current_turn, Math.max(0, entities.length - 1));
    const updated = { ...encounter, entities, current_turn: currentTurn };
    setEncounter(updated);
    broadcastUpdate(updated);
  };

  // Feature 2 — Appliquer un delta de PV à une entité
  const applyHPDelta = (entityId) => {
    const delta = parseInt(hpDeltas[entityId] || '0');
    if (!delta || !encounter) return;
    let updatedEntity = null;
    const entities = encounter.entities.map(e => {
      if (e.id !== entityId || !canEditEntity(e)) return e;
      const newHp = Math.max(0, Math.min(e.hp_max ?? 999, e.hp + delta));
      updatedEntity = { ...e, hp: newHp };
      return updatedEntity;
    });
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    // Synchroniser avec la fiche personnage si l'entité y est liée
    if (updatedEntity?.characterId && socket) {
      socket.emit('character-update', {
        sessionId,
        character: { id: updatedEntity.characterId, hp_current: updatedEntity.hp },
      });
    }
    setHpDeltas(prev => ({ ...prev, [entityId]: '' }));
  };

  // Feature 3 — Ouvrir le sélecteur de statut en position viewport
  const openStatusPicker = (entityId, e) => {
    if (statusOpen === entityId) { setStatusOpen(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setStatusPickerPos({
      left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
      top: Math.min(rect.bottom + 4, window.innerHeight - 290),
    });
    setStatusOpen(entityId);
  };

  // Feature 3 — Ajouter / retirer un statut (tout le monde peut le faire)
  const toggleStatus = (entityId, status) => {
    if (!encounter) return;
    const entities = encounter.entities.map(e => {
      if (e.id !== entityId) return e;
      const statuses = e.statuses || [];
      return {
        ...e,
        statuses: statuses.includes(status)
          ? statuses.filter(s => s !== status)
          : [...statuses, status],
      };
    });
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    setStatusOpen(null);
  };

  const nextTurn = () => {
    if (!encounter || !encounter.entities.length) return;
    const next = (encounter.current_turn + 1) % encounter.entities.length;
    const round = next === 0 ? encounter.round + 1 : encounter.round;
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

  // Feature 4 — Joueur passe son propre tour
  const skipMyTurn = () => {
    if (!encounter || !encounter.entities.length) return;
    const next = (encounter.current_turn + 1) % encounter.entities.length;
    const round = next === 0 ? encounter.round + 1 : encounter.round;
    const updated = { ...encounter, current_turn: next, round };
    setEncounter(updated);
    if (socket) socket.emit('combat-next-turn', { sessionId, encounter: updated });
    broadcastUpdate(updated);
  };

  const endCombat = async () => {
    if (!encounter) return;
    await fetch(`${API}/combat/${encounter.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: false }),
    });
    setEncounter(null);
    if (socket) socket.emit('combat-update', { sessionId, encounter: null });
  };

  const activeEntity = encounter?.entities[encounter?.current_turn];
  // Feature 4 — vrai si c'est le tour d'une entité appartenant au joueur connecté
  const isMyTurn = !isDM && !!activeEntity && (
    activeEntity.addedBy === user?.id || activeEntity.userId === user?.id
  );

  // ── Aucun combat actif ───────────────────────────────────────────────────────
  if (!encounter) {
    return (
      <div className="card animate-fade-in" style={{ textAlign: 'center', padding: 'var(--space-lg)' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 'var(--space-sm)' }}>⚔️</div>
        <h3 style={{ fontFamily: 'var(--font-heading)', marginBottom: 'var(--space-sm)', fontSize: '1rem' }}>
          Aucun combat en cours
        </h3>
        {isDM && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', alignItems: 'stretch' }}>
            <input
              type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Nom du combat" onKeyDown={e => e.key === 'Enter' && createEncounter()}
            />
            <button className="btn btn-primary" onClick={createEncounter}>⚔️ Lancer un combat</button>
          </div>
        )}
      </div>
    );
  }

  // ── Combat actif ─────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in">

      {/* En-tête */}
      <div className="card" style={{ marginBottom: 'var(--space-sm)', padding: 'var(--space-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{
              fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)',
              fontSize: '0.95rem', margin: 0,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px',
            }}>
              ⚔️ {encounter.name || 'Combat'}
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Round {encounter.round} • {encounter.entities.length} entités
            </span>
          </div>
          <div style={{ display: 'flex', gap: '4px', flexShrink: 0, flexWrap: 'wrap' }}>
            {/* Feature 4 — bouton visible uniquement si c'est le tour d'une entité du joueur */}
            {isMyTurn && (
              <button className="btn btn-primary btn-sm" onClick={skipMyTurn} title="Passer mon tour">
                Passer ▶
              </button>
            )}
            {isDM && (
              <>
                <button className="btn btn-secondary btn-sm" onClick={prevTurn} title="Tour précédent">◀</button>
                <button className="btn btn-primary btn-sm" onClick={nextTurn} title="Tour suivant">Tour ▶</button>
                <button className="btn btn-danger btn-sm" onClick={endCombat} title="Fin du combat">✕</button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bandeau entité active */}
      {activeEntity && (
        <div className="card animate-glow" style={{
          marginBottom: 'var(--space-md)', textAlign: 'center',
          borderColor: 'var(--accent-primary)', background: 'rgba(201, 168, 76, 0.05)',
          padding: 'var(--space-sm) var(--space-md)',
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tour actif</span>
          <div style={{ fontSize: '1.3rem', fontFamily: 'var(--font-heading)', color: 'var(--accent-primary)' }}>
            {activeEntity.type === 'enemy' ? '💀' : '🛡️'} {activeEntity.name}
          </div>
        </div>
      )}

      {/* Liste d'initiative */}
      <div className="panel" style={{ marginBottom: 'var(--space-md)' }}>
        <div className="panel-header">
          <h3>📋 Ordre d'initiative</h3>
        </div>
        <div style={{ padding: 'var(--space-sm)' }}>
          {encounter.entities.map((entity, i) => {
            const isActive = i === encounter.current_turn;
            const hpMax = entity.hp_max ?? entity.maxHp ?? 1;
            const hpPct = (entity.hp / Math.max(hpMax, 1)) * 100;
            const hpClass = hpPct > 60 ? 'hp-high' : hpPct > 30 ? 'hp-mid' : 'hp-low';
            const statuses = entity.statuses || [];

            return (
              <div
                key={entity.id}
                className={`initiative-row ${isActive ? 'active' : ''}`}
                style={{ marginBottom: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}
              >
                <div className="turn-indicator" style={{ marginTop: '4px' }} />
                <span style={{
                  fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent-primary)',
                  minWidth: '28px', textAlign: 'center', marginTop: '2px',
                }}>
                  {entity.initiative}
                </span>
                <span style={{ fontSize: '1rem', marginTop: '2px' }}>
                  {entity.type === 'enemy' ? '💀' : '🛡️'}
                </span>

                {/* Nom, barre HP et badges statuts */}
                <div style={{ flex: 1, minWidth: '80px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{entity.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px', flexWrap: 'wrap' }}>
                    <div className="hp-bar-container" style={{ width: '80px', height: '5px' }}>
                      <div
                        className={`hp-bar ${hpClass}`}
                        style={{ width: `${Math.min(100, Math.max(0, hpPct))}%` }}
                      />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {entity.hp}/{hpMax} PV
                    </span>
                  </div>
                  {/* Feature 3 — badges statuts actifs, cliquer pour retirer */}
                  {statuses.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginTop: '4px' }}>
                      {statuses.map(s => {
                        const sc = STATUS_STYLE[s] || { bg: 'rgba(201,168,76,0.15)', color: '#c9a84c' };
                        return (
                          <span
                            key={s}
                            onClick={() => toggleStatus(entity.id, s)}
                            title={`Retirer : ${s}`}
                            style={{
                              fontSize: '0.6rem', padding: '1px 5px', borderRadius: 8, cursor: 'pointer',
                              background: sc.bg, color: sc.color, border: `1px solid ${sc.color}44`,
                              userSelect: 'none',
                            }}
                          >
                            {s} ✕
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Feature 3 — bouton sélecteur de statut (tout le monde)
                    Le picker est rendu en position:fixed (viewport) pour ne pas être clippé
                    par l'overflow:hidden/auto du FloatingPanel parent */}
                <button
                  data-status-picker
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => openStatusPicker(entity.id, e)}
                  title="Gérer les statuts"
                  style={{ padding: '3px 7px', fontSize: '0.75rem', flexShrink: 0 }}
                >
                  ✦
                </button>

                {/* Feature 2 — input PV + supprimer (visible si l'utilisateur peut éditer cette entité) */}
                {canEditEntity(entity) && (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={hpDeltas[entity.id] || ''}
                      onChange={e => setHpDeltas(prev => ({ ...prev, [entity.id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && applyHPDelta(entity.id)}
                      placeholder="±PV"
                      style={{ width: '52px', textAlign: 'center', fontSize: '0.78rem', padding: '3px 4px' }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => applyHPDelta(entity.id)}
                      title="Appliquer"
                      style={{ padding: '4px 7px' }}
                    >
                      ✓
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => removeEntity(entity.id)}
                      title="Retirer du combat"
                      style={{ fontSize: '0.8rem' }}
                    >
                      ✕
                    </button>
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

      {/* Feature 3 — Picker de statut en position:fixed (hors du flow, non clippé) */}
      {statusOpen && (
        <div
          data-status-picker
          style={{
            position: 'fixed',
            left: statusPickerPos.left,
            top: statusPickerPos.top,
            zIndex: 9999,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            padding: '8px',
            display: 'flex', flexWrap: 'wrap', gap: '5px',
            width: '208px',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {ALL_STATUSES.map(s => {
            const active = (encounter.entities.find(e => e.id === statusOpen)?.statuses || []).includes(s);
            const sc = STATUS_STYLE[s] || { bg: 'rgba(201,168,76,0.15)', color: '#c9a84c' };
            return (
              <span
                key={s}
                onClick={() => toggleStatus(statusOpen, s)}
                style={{
                  fontSize: '0.65rem', padding: '3px 7px', borderRadius: 8, cursor: 'pointer',
                  background: active ? sc.bg : 'var(--bg-tertiary)',
                  color: active ? sc.color : 'var(--text-muted)',
                  border: `1px solid ${active ? sc.color + '55' : 'var(--border-color)'}`,
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {active ? '✓ ' : ''}{s}
              </span>
            );
          })}
        </div>
      )}

      {/* Formulaire ajout entité — MJ uniquement */}
      {isDM && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          <h4 style={{
            fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)',
            fontSize: '0.9rem', marginBottom: 'var(--space-sm)',
          }}>
            + Ajouter une entité
          </h4>
          <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }}>
              <label>Nom</label>
              <input type="text" value={entityName} onChange={e => setEntityName(e.target.value)} placeholder="Gobelin…" />
            </div>
            <div className="form-group" style={{ width: '68px', marginBottom: 0 }}>
              <label>Init.</label>
              <input type="number" value={entityInit} onChange={e => setEntityInit(e.target.value)} placeholder="15" />
            </div>
            <div className="form-group" style={{ width: '68px', marginBottom: 0 }}>
              <label>PV</label>
              <input type="number" value={entityHP} onChange={e => setEntityHP(e.target.value)} placeholder="20" />
            </div>
            <div className="form-group" style={{ width: '110px', marginBottom: 0 }}>
              <label>Type</label>
              <select value={entityType} onChange={e => setEntityType(e.target.value)}>
                <option value="enemy">💀 Ennemi</option>
                <option value="player">🛡️ Joueur</option>
                <option value="npc">🧑 PNJ</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={addEntity} style={{ marginBottom: 0 }}>Ajouter</button>
          </div>
        </div>
      )}

      {/* Feature 1 — Rejoindre le combat (joueurs uniquement) */}
      {!isDM && (
        <div className="card">
          {!showJoin ? (
            <button className="btn btn-primary w-full" onClick={() => setShowJoin(true)}>
              ⚔️ Rejoindre le combat
            </button>
          ) : (
            <>
              <h4 style={{
                fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)',
                fontSize: '0.9rem', marginBottom: 'var(--space-sm)',
              }}>
                ⚔️ Rejoindre le combat
              </h4>

              {/* Choix : mon personnage ou compagnon/familier */}
              <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-sm)' }}>
                {myCharacter && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="radio" checked={joinType === 'character'} onChange={() => setJoinType('character')} />
                    🛡️ {myCharacter.name}
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                  <input type="radio" checked={joinType === 'companion'} onChange={() => setJoinType('companion')} />
                  🐾 Compagnon
                </label>
              </div>

              {/* Champs spécifiques au compagnon */}
              {joinType === 'companion' && (
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                  <input
                    type="text" placeholder="Nom du compagnon"
                    value={joinName} onChange={e => setJoinName(e.target.value)}
                    style={{ flex: 1, minWidth: '100px' }}
                  />
                  <input
                    type="number" placeholder="PV"
                    value={joinHp} onChange={e => setJoinHp(e.target.value)}
                    style={{ width: '68px' }}
                  />
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 'var(--space-sm)' }}>
                <label>Initiative</label>
                <input
                  type="number" placeholder="Résultat de votre jet d'initiative"
                  value={joinInit} onChange={e => setJoinInit(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={joinCombat}>
                  Rejoindre
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowJoin(false);
                    setJoinName(''); setJoinInit(''); setJoinHp('');
                  }}
                >
                  Annuler
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
