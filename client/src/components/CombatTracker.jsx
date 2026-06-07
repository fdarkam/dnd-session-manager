import { useState, useEffect, useRef } from 'react';
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
  const encounterRef = useRef(null);

  const [newName, setNewName] = useState('');

  const [entityName, setEntityName] = useState('');
  const [entityInit, setEntityInit] = useState('');
  const [entityHP, setEntityHP] = useState('');
  const [entityType, setEntityType] = useState('enemy');

  const [showJoin, setShowJoin] = useState(false);
  const [joinType, setJoinType] = useState('character');
  const [joinName, setJoinName] = useState('');
  const [joinInit, setJoinInit] = useState('');
  const [joinHp, setJoinHp] = useState('');
  const [joinHpMax, setJoinHpMax] = useState('');
  const [joinAc, setJoinAc] = useState('');
  const [myCharacter, setMyCharacter] = useState(null);

  // Fix 1 — valeur saisie par entité (entityId → chaîne signée ex: "10", "-5", "+10")
  const [hpDeltas, setHpDeltas] = useState({});
  // Flash PV visuel (entityId → { text, color })
  const [hpFlash, setHpFlash] = useState({});

  const [statusOpen, setStatusOpen] = useState(null);
  const [statusPickerPos, setStatusPickerPos] = useState({ left: 0, top: 0 });

  useEffect(() => { encounterRef.current = encounter; }, [encounter]);
  useEffect(() => { fetchEncounter(); }, [sessionId]);

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

    // Sync PV fiche → combat
    const onCharUpdated = (character) => {
      const prev = encounterRef.current;
      if (!prev?.entities) return;
      const hasMatch = prev.entities.some(e => e.characterId === character.id);
      if (!hasMatch) return;
      const entities = prev.entities.map(e =>
        e.characterId === character.id
          ? { ...e, hp: character.hp_current ?? e.hp }
          : e
      );
      const updated = { ...prev, entities };
      setEncounter(updated);
      fetch(`${API}/combat/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ entities: updated.entities, current_turn: updated.current_turn, round: updated.round }),
      }).catch(() => {});
      socket.emit('combat-update', { sessionId, encounter: updated });
    };

    socket.on('combat-updated', onUpdated);
    socket.on('combat-turn-changed', onTurnChanged);
    socket.on('character-updated', onCharUpdated);
    return () => {
      socket.off('combat-updated', onUpdated);
      socket.off('combat-turn-changed', onTurnChanged);
      socket.off('character-updated', onCharUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!statusOpen) return;
    const handler = (e) => {
      if (!e.target.closest('[data-status-picker]')) setStatusOpen(null);
    };
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
        ac: myCharacter.ac ?? 10,
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
        hp_max: parseInt(joinHpMax) || parseInt(joinHp) || 10,
        ac: parseInt(joinAc) || 10,
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
    setJoinType('character');
    setJoinName(''); setJoinInit(''); setJoinHp(''); setJoinHpMax(''); setJoinAc('');
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

  // Appliquer un delta de PV avec flash visuel
  // forceDelta : valeur signée imposée (boutons + et -), sinon on lit hpDeltas[entityId]
  const applyHPDelta = (entityId, forceDelta) => {
    const delta = forceDelta !== undefined
      ? forceDelta
      : parseInt(hpDeltas[entityId] || '0');
    if (!delta || isNaN(delta) || !encounter) return;
    let updatedEntity = null;
    const entities = encounter.entities.map(e => {
      if (e.id !== entityId || !canEditEntity(e)) return e;
      const newHp = Math.max(0, Math.min(e.hp_max ?? 999, e.hp + delta));
      updatedEntity = { ...e, hp: newHp };
      return updatedEntity;
    });
    if (!updatedEntity) return;
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    if (updatedEntity.characterId && socket) {
      socket.emit('character-update', {
        sessionId,
        character: { id: updatedEntity.characterId, hp_current: updatedEntity.hp },
      });
    }
    // Flash vert pour soins, rouge pour dégâts
    const flashText = delta > 0 ? `+${delta}` : `${delta}`;
    const flashColor = delta > 0 ? '#22c55e' : '#f87171';
    setHpFlash(prev => ({ ...prev, [entityId]: { text: flashText, color: flashColor } }));
    setTimeout(() => setHpFlash(prev => { const n = { ...prev }; delete n[entityId]; return n; }), 1500);
    setHpDeltas(prev => ({ ...prev, [entityId]: '' }));
  };

  // Fix 1 — Signe automatique sur l'input PV
  // - : transforme la valeur courante en négative (dégâts)
  // + : transforme la valeur courante en positive (soins)
  // Entrée : applique la valeur telle quelle (signée)
  const handleHpKeyDown = (entityId, e) => {
    if (e.key === '-') {
      e.preventDefault();
      setHpDeltas(prev => {
        const abs = Math.abs(parseInt(prev[entityId] || '') || 0);
        return { ...prev, [entityId]: abs > 0 ? String(-abs) : prev[entityId] ?? '' };
      });
    } else if (e.key === '+') {
      e.preventDefault();
      setHpDeltas(prev => {
        const abs = Math.abs(parseInt(prev[entityId] || '') || 0);
        return { ...prev, [entityId]: abs > 0 ? String(abs) : prev[entityId] ?? '' };
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      applyHPDelta(entityId);
    }
  };

  // Fix 2 — Helpers pour les boutons + et - inline
  // Lit la valeur absolue de l'input et l'applique avec le signe voulu
  const applyPositive = (entityId) => {
    const abs = Math.abs(parseInt(hpDeltas[entityId] || '') || 0);
    if (abs > 0) applyHPDelta(entityId, abs);
  };
  const applyNegative = (entityId) => {
    const abs = Math.abs(parseInt(hpDeltas[entityId] || '') || 0);
    if (abs > 0) applyHPDelta(entityId, -abs);
  };

  const openStatusPicker = (entityId, e) => {
    if (statusOpen === entityId) { setStatusOpen(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setStatusPickerPos({
      left: Math.max(8, Math.min(rect.right - 208, window.innerWidth - 216)),
      top: Math.min(rect.bottom + 4, window.innerHeight - 290),
    });
    setStatusOpen(entityId);
  };

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
            const flash = hpFlash[entity.id];
            const canEdit = canEditEntity(entity);

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

                {/* Nom + barre HP + CA + badges statuts */}
                <div style={{ flex: 1, minWidth: '80px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{entity.name}</div>

                  {/* Fix 2 — Ligne PV : barre + texte + CA + input inline */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px', flexWrap: 'wrap' }}>
                    <div className="hp-bar-container" style={{ width: '60px', height: '5px', flexShrink: 0 }}>
                      <div
                        className={`hp-bar ${hpClass}`}
                        style={{ width: `${Math.min(100, Math.max(0, hpPct))}%` }}
                      />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {entity.hp}/{hpMax} PV
                      {/* Flash vert (soins) ou rouge (dégâts) après application */}
                      {flash && (
                        <span style={{ color: flash.color, marginLeft: '4px', fontWeight: 700 }}>
                          {flash.text}
                        </span>
                      )}
                    </span>
                    {entity.ac != null && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        🛡 {entity.ac}
                      </span>
                    )}

                    {/* Fix 2 — Input PV inline, visible en permanence si le joueur peut éditer */}
                    {canEdit && (
                      <>
                        {/* Fix 1 — type text pour intercepter + et - avant le navigateur */}
                        <input
                          type="text"
                          value={hpDeltas[entity.id] || ''}
                          onChange={e => setHpDeltas(prev => ({ ...prev, [entity.id]: e.target.value }))}
                          onKeyDown={e => handleHpKeyDown(entity.id, e)}
                          placeholder="PV"
                          title="Tapez un nombre puis + (soins) ou − (dégâts) ou Entrée"
                          style={{
                            width: '42px', textAlign: 'center',
                            fontSize: '0.72rem', padding: '2px 3px',
                            flexShrink: 0,
                          }}
                        />
                        {/* Bouton + : applique la valeur absolue en positif (soins) */}
                        <button
                          className="btn btn-sm"
                          onClick={() => applyPositive(entity.id)}
                          title="Soins (+)"
                          style={{
                            padding: '1px 6px', fontSize: '0.78rem', fontWeight: 700,
                            color: '#22c55e', background: 'rgba(34,197,94,0.12)',
                            border: '1px solid rgba(34,197,94,0.35)', borderRadius: '4px',
                            cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          +
                        </button>
                        {/* Bouton − : applique la valeur absolue en négatif (dégâts) */}
                        <button
                          className="btn btn-sm"
                          onClick={() => applyNegative(entity.id)}
                          title="Dégâts (−)"
                          style={{
                            padding: '1px 6px', fontSize: '0.78rem', fontWeight: 700,
                            color: '#f87171', background: 'rgba(248,113,113,0.12)',
                            border: '1px solid rgba(248,113,113,0.35)', borderRadius: '4px',
                            cursor: 'pointer', flexShrink: 0,
                          }}
                        >
                          −
                        </button>
                      </>
                    )}
                  </div>

                  {/* Badges statuts actifs — cliquer pour retirer */}
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

                {/* Bouton sélecteur de statut (position:fixed pour ne pas être clippé) */}
                <button
                  data-status-picker
                  className="btn btn-secondary btn-sm"
                  onClick={(e) => openStatusPicker(entity.id, e)}
                  title="Gérer les statuts"
                  style={{ padding: '3px 7px', fontSize: '0.75rem', flexShrink: 0 }}
                >
                  ✦
                </button>

                {/* Bouton retirer du combat — visible si le joueur peut éditer cette entité */}
                {canEdit && (
                  <button
                    className="btn-icon"
                    onClick={() => removeEntity(entity.id)}
                    title="Retirer du combat"
                    style={{ fontSize: '0.8rem', flexShrink: 0 }}
                  >
                    ✕
                  </button>
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

      {/* Picker de statut en position:fixed (hors du flow, non clippé) */}
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

      {/* Rejoindre le combat — joueurs uniquement */}
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

              {joinType === 'character' && myCharacter && (
                <div style={{
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  marginBottom: 'var(--space-sm)', padding: '6px 8px',
                  background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                }}>
                  PV {myCharacter.hp_current ?? myCharacter.hp_max ?? '?'}/{myCharacter.hp_max ?? '?'} • CA {myCharacter.ac ?? '?'}
                </div>
              )}

              {joinType === 'companion' && (
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                  <input
                    type="text" placeholder="Nom du compagnon"
                    value={joinName} onChange={e => setJoinName(e.target.value)}
                    style={{ flex: 1, minWidth: '100px' }}
                  />
                  <input
                    type="number" placeholder="PV act."
                    value={joinHp} onChange={e => setJoinHp(e.target.value)}
                    style={{ width: '64px' }}
                  />
                  <input
                    type="number" placeholder="PV max"
                    value={joinHpMax} onChange={e => setJoinHpMax(e.target.value)}
                    style={{ width: '64px' }}
                  />
                  <input
                    type="number" placeholder="CA"
                    value={joinAc} onChange={e => setJoinAc(e.target.value)}
                    style={{ width: '56px' }}
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
                    setJoinType('character');
                    setJoinName(''); setJoinInit(''); setJoinHp(''); setJoinHpMax(''); setJoinAc('');
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
