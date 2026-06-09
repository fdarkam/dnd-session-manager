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

  // Formulaire entité manuelle (section 2 du panneau MJ)
  const [entityName, setEntityName] = useState('');
  const [entityInit, setEntityInit] = useState('');
  const [entityHP, setEntityHP] = useState('');
  const [entityType, setEntityType] = useState('enemy');
  // Fix 2 : erreurs de validation du formulaire entité manuelle
  const [entityErrors, setEntityErrors] = useState({});

  // ── Panneau ajout MJ ──────────────────────────────────────────────────────────
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [sessionCharacters, setSessionCharacters] = useState([]);
  const [selectedCharacter, setSelectedCharacter] = useState(null);
  const [dmAddInit, setDmAddInit] = useState('');

  // Rejoindre le combat — joueurs
  const [showJoin, setShowJoin] = useState(false);
  const [joinType, setJoinType] = useState('character');
  const [joinName, setJoinName] = useState('');
  const [joinInit, setJoinInit] = useState('');
  const [joinHp, setJoinHp] = useState('');
  const [joinHpMax, setJoinHpMax] = useState('');
  // Fix 3 : suppression de l'état joinAc — le champ CA est retiré du formulaire
  // Fix 2 : erreurs de validation du formulaire rejoindre
  const [joinErrors, setJoinErrors] = useState({});
  // myCharacter : fiche du joueur connecté (utilisée dans le flow "Rejoindre")
  const [myCharacter, setMyCharacter] = useState(null);

  const [hpDeltas, setHpDeltas] = useState({});
  const [hpFlash, setHpFlash] = useState({});

  const [statusOpen, setStatusOpen] = useState(null);
  const [statusPickerPos, setStatusPickerPos] = useState({ left: 0, top: 0 });

  useEffect(() => { encounterRef.current = encounter; }, [encounter]);
  useEffect(() => { fetchEncounter(); }, [sessionId]);

  // Charge toutes les fiches de la session.
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${API}/characters/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (Array.isArray(data)) {
          setSessionCharacters(data);
          if (data.length > 0) setMyCharacter(data[0]);
        }
      });
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

    const onCharUpdated = (character) => {
      const prev = encounterRef.current;
      if (!prev?.entities) return;
      const hasMatch = prev.entities.some(e => e.characterId === character.id);
      if (!hasMatch) return;
      const entities = prev.entities.map(e =>
        e.characterId === character.id ? { ...e, hp: character.hp_current ?? e.hp } : e
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

  // Fix 2 : validation des champs obligatoires avant ajout d'une entité manuelle
  const addEntity = () => {
    if (!encounter) return;
    const errors = {};
    if (!entityName.trim()) errors.name = 'Nom requis';
    if (!entityInit || isNaN(parseInt(entityInit))) errors.initiative = 'Initiative requise';
    if (!entityHP || isNaN(parseInt(entityHP))) errors.hp = 'PV requis';
    if (Object.keys(errors).length > 0) {
      setEntityErrors(errors);
      return;
    }
    setEntityErrors({});
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

  // Fix 2 : touche Entrée sur les champs entité manuelle déclenche la validation
  const handleEntityKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntity();
    }
  };

  // Fix 3 : suppression de ac dans la création depuis une fiche joueur
  const addFromSheet = () => {
    if (!selectedCharacter || !encounter) return;
    const newEntity = {
      id: Date.now().toString(),
      name: selectedCharacter.name || 'Personnage',
      initiative: parseInt(dmAddInit) || 0,
      hp: selectedCharacter.hp_current ?? selectedCharacter.hp_max ?? 10,
      hp_max: selectedCharacter.hp_max ?? 10,
      type: 'player',
      characterId: selectedCharacter.id,
      addedBy: user?.id,
      statuses: [],
    };
    const entities = [...(encounter.entities || []), newEntity];
    entities.sort((a, b) => b.initiative - a.initiative);
    const updated = { ...encounter, entities };
    setEncounter(updated);
    broadcastUpdate(updated);
    closeDmAddPanel();
  };

  // Ferme le panneau MJ et réinitialise tous ses états
  const closeDmAddPanel = () => {
    setShowAddPanel(false);
    setSelectedCharacter(null);
    setDmAddInit('');
    setEntityName(''); setEntityInit(''); setEntityHP('');
    setEntityErrors({});
  };

  // Fix 2 : validation des champs obligatoires avant de rejoindre le combat
  // Fix 3 : suppression de ac dans la structure de l'entité créée
  const joinCombat = () => {
    if (!encounter) return;
    const errors = {};
    if (!joinInit || isNaN(parseInt(joinInit))) {
      errors.initiative = 'Initiative requise';
    }
    if (joinType === 'companion') {
      if (!joinName.trim()) errors.name = 'Nom requis';
      if (!joinHp || isNaN(parseInt(joinHp))) errors.hp = 'PV requis';
    }
    if (Object.keys(errors).length > 0) {
      setJoinErrors(errors);
      return;
    }
    setJoinErrors({});
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
      newEntity = {
        id: Date.now().toString(),
        name: joinName,
        initiative: parseInt(joinInit) || 0,
        hp: parseInt(joinHp) || 10,
        hp_max: parseInt(joinHpMax) || parseInt(joinHp) || 10,
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
    setJoinName(''); setJoinInit(''); setJoinHp(''); setJoinHpMax('');
  };

  // Fix 2 : touche Entrée sur les champs du formulaire "Rejoindre" déclenche la validation
  const handleJoinKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      joinCombat();
    }
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
    const flashText = delta > 0 ? `+${delta}` : `${delta}`;
    const flashColor = delta > 0 ? '#22c55e' : '#f87171';
    setHpFlash(prev => ({ ...prev, [entityId]: { text: flashText, color: flashColor } }));
    setTimeout(() => setHpFlash(prev => { const n = { ...prev }; delete n[entityId]; return n; }), 1500);
    setHpDeltas(prev => ({ ...prev, [entityId]: '' }));
  };

  // Signe automatique : - passe la valeur en négatif, + en positif, Entrée applique telle quelle
  const handleHpKeyDown = (entityId, e) => {
    if (e.key === '-') {
      e.preventDefault();
      setHpDeltas(prev => {
        const abs = Math.abs(parseInt(prev[entityId] || '') || 0);
        return { ...prev, [entityId]: abs > 0 ? String(-abs) : (prev[entityId] ?? '') };
      });
    } else if (e.key === '+') {
      e.preventDefault();
      setHpDeltas(prev => {
        const abs = Math.abs(parseInt(prev[entityId] || '') || 0);
        return { ...prev, [entityId]: abs > 0 ? String(abs) : (prev[entityId] ?? '') };
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      applyHPDelta(entityId);
    }
  };

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

  // Fix 1 : détecte si le joueur connecté est déjà présent dans le combat (hors compagnons)
  // Vérifie userId (ajout direct) OU characterId (ajout par le MJ depuis une fiche)
  const alreadyInCombat = !isDM && !!encounter?.entities?.some(
    e => e.userId === user?.id || (myCharacter?.id && e.characterId === myCharacter.id)
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
            const showHp = isDM || entity.type !== 'enemy';

            return (
              <div
                key={entity.id}
                className={`initiative-row ${isActive ? 'active' : ''}`}
                style={{
                  marginBottom: '8px',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: '4px',
                }}
              >
                {/* Ligne 1 — nom à gauche, boutons ✦ et ✕ à droite */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                    <div className="turn-indicator" />
                    <span style={{
                      fontWeight: 600, fontSize: '0.88rem',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {entity.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    <button
                      data-status-picker
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => openStatusPicker(entity.id, e)}
                      title="Gérer les statuts"
                      style={{ padding: '3px 7px', fontSize: '0.75rem' }}
                    >
                      ✦
                    </button>
                    {canEdit && (
                      <button
                        className="btn-icon"
                        onClick={() => removeEntity(entity.id)}
                        title="Retirer du combat"
                        style={{ fontSize: '0.8rem' }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Ligne 2 — barre HP + texte PV + type + initiative (Fix 3 : CA supprimé) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <div className="hp-bar-container" style={{ width: '60px', height: '5px', flexShrink: 0 }}>
                    <div
                      className={`hp-bar ${hpClass}`}
                      style={{ width: `${Math.min(100, Math.max(0, hpPct))}%` }}
                    />
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {showHp ? `${entity.hp}/${hpMax} PV` : '??? PV'}
                    {showHp && flash && (
                      <span style={{ color: flash.color, marginLeft: '4px', fontWeight: 700 }}>
                        {flash.text}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {entity.type === 'enemy' ? '💀' : '🛡️'} {entity.initiative}
                  </span>
                </div>

                {/* Ligne 3 — Pill group [ input ][ + ][ − ] */}
                {canEdit && showHp && (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={hpDeltas[entity.id] || ''}
                      onChange={e => setHpDeltas(prev => ({ ...prev, [entity.id]: e.target.value }))}
                      onKeyDown={e => handleHpKeyDown(entity.id, e)}
                      placeholder="PV"
                      title="Tapez un nombre · − dégâts · + soins · Entrée valider"
                      style={{
                        width: '48px',
                        height: '26px',
                        boxSizing: 'border-box',
                        border: '1px solid var(--border-color)',
                        borderRight: 'none',
                        borderRadius: '4px 0 0 4px',
                        textAlign: 'center',
                        fontSize: '0.72rem',
                        padding: '0 4px',
                        background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => applyPositive(entity.id)}
                      title="Soins"
                      style={{
                        width: '28px',
                        height: '26px',
                        boxSizing: 'border-box',
                        border: '1px solid var(--border-color)',
                        borderRight: 'none',
                        borderRadius: 0,
                        background: 'rgba(34,197,94,0.13)',
                        color: '#22c55e',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <button
                      onClick={() => applyNegative(entity.id)}
                      title="Dégâts"
                      style={{
                        width: '28px',
                        height: '26px',
                        boxSizing: 'border-box',
                        border: '1px solid var(--border-color)',
                        borderRadius: '0 4px 4px 0',
                        background: 'rgba(248,113,113,0.13)',
                        color: '#f87171',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        lineHeight: 1,
                        cursor: 'pointer',
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                  </div>
                )}

                {/* Ligne 4 — badges statuts actifs, cliquer pour retirer */}
                {statuses.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
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

      {/* ── Panneau ajout MJ — affiché uniquement pour le MJ ──────────────────── */}
      {isDM && (
        <div className="card" style={{ marginBottom: 'var(--space-md)' }}>
          {!showAddPanel ? (
            <button className="btn btn-primary w-full" onClick={() => setShowAddPanel(true)}>
              + Ajouter un personnage
            </button>
          ) : (
            <>
              <h4 style={{
                fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)',
                fontSize: '0.9rem', marginBottom: 'var(--space-md)',
              }}>
                + Ajouter une entité
              </h4>

              {/* ── Section 1 : Depuis une fiche joueur ──────────────────────── */}
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <h5 style={{
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  marginBottom: 'var(--space-sm)', fontWeight: 600,
                }}>
                  🛡️ Depuis une fiche joueur
                </h5>

                {sessionCharacters.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Aucune fiche disponible dans cette session.
                  </p>
                ) : selectedCharacter ? (
                  // Mini-formulaire : seule l'initiative est saisie, le reste vient de la fiche
                  <div style={{
                    background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                    padding: '10px', marginBottom: 'var(--space-sm)',
                  }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {selectedCharacter.name}
                    </div>
                    {/* Fix 3 : affichage CA supprimé — seuls les PV sont montrés */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      {selectedCharacter.hp_current ?? selectedCharacter.hp_max ?? '?'}/{selectedCharacter.hp_max ?? '?'} PV
                    </div>
                    <div className="form-group" style={{ marginBottom: 'var(--space-sm)' }}>
                      <label style={{ fontSize: '0.78rem' }}>Initiative</label>
                      <input
                        type="number"
                        value={dmAddInit}
                        onChange={e => setDmAddInit(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addFromSheet()}
                        placeholder="Jet d'initiative"
                        autoFocus
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={addFromSheet}>
                        Confirmer
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => { setSelectedCharacter(null); setDmAddInit(''); }}
                      >
                        ← Retour
                      </button>
                    </div>
                  </div>
                ) : (
                  // Liste des fiches : grisée et non cliquable si le personnage est déjà dans le combat
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: 'var(--space-sm)' }}>
                    {sessionCharacters.map(char => {
                      const alreadyIn = encounter?.entities?.some(e => e.characterId === char.id);
                      return (
                        <button
                          key={char.id}
                          onClick={alreadyIn ? undefined : () => setSelectedCharacter(char)}
                          disabled={alreadyIn}
                          title={alreadyIn ? 'Déjà dans le combat' : `Ajouter ${char.name}`}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            background: alreadyIn ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                            color: alreadyIn ? 'var(--text-muted)' : 'var(--text-primary)',
                            opacity: alreadyIn ? 0.5 : 1,
                            cursor: alreadyIn ? 'not-allowed' : 'pointer',
                            fontSize: '0.82rem', textAlign: 'left', width: '100%',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{char.name}</span>
                          {/* Fix 3 : CA supprimé de la liste des fiches */}
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {char.hp_current ?? char.hp_max ?? '?'}/{char.hp_max ?? '?'} PV
                            {alreadyIn && ' · Déjà présent'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Séparateur entre les deux sections */}
              <div style={{ borderTop: '1px solid var(--border-color)', margin: '0 0 var(--space-md)' }} />

              {/* ── Section 2 : Entité manuelle (ennemi / PNJ) ───────────────── */}
              <div style={{ marginBottom: 'var(--space-sm)' }}>
                <h5 style={{
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  marginBottom: 'var(--space-sm)', fontWeight: 600,
                }}>
                  💀 Entité manuelle (ennemi / PNJ)
                </h5>
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="form-group" style={{ flex: 1, minWidth: '100px', marginBottom: 0 }}>
                    <label>Nom</label>
                    {/* Fix 2 : Entrée déclenche l'ajout — bordure rouge si champ vide */}
                    <input
                      type="text"
                      value={entityName}
                      onChange={e => setEntityName(e.target.value)}
                      onKeyDown={handleEntityKeyDown}
                      placeholder="Gobelin…"
                      style={{ borderColor: entityErrors.name ? '#f87171' : undefined }}
                    />
                  </div>
                  <div className="form-group" style={{ width: '68px', marginBottom: 0 }}>
                    <label>Init.</label>
                    <input
                      type="number"
                      value={entityInit}
                      onChange={e => setEntityInit(e.target.value)}
                      onKeyDown={handleEntityKeyDown}
                      placeholder="15"
                      style={{ borderColor: entityErrors.initiative ? '#f87171' : undefined }}
                    />
                  </div>
                  <div className="form-group" style={{ width: '68px', marginBottom: 0 }}>
                    <label>PV</label>
                    <input
                      type="number"
                      value={entityHP}
                      onChange={e => setEntityHP(e.target.value)}
                      onKeyDown={handleEntityKeyDown}
                      placeholder="20"
                      style={{ borderColor: entityErrors.hp ? '#f87171' : undefined }}
                    />
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
                {/* Fix 2 : messages d'erreur sous le formulaire entité manuelle */}
                {(entityErrors.name || entityErrors.initiative || entityErrors.hp) && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {entityErrors.name && (
                      <span style={{ color: '#f87171', fontSize: '0.72rem' }}>{entityErrors.name}</span>
                    )}
                    {entityErrors.initiative && (
                      <span style={{ color: '#f87171', fontSize: '0.72rem' }}>{entityErrors.initiative}</span>
                    )}
                    {entityErrors.hp && (
                      <span style={{ color: '#f87171', fontSize: '0.72rem' }}>{entityErrors.hp}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Bouton Annuler — ferme le panneau et réinitialise tous les champs */}
              <button
                className="btn btn-secondary w-full"
                style={{ marginTop: 'var(--space-sm)' }}
                onClick={closeDmAddPanel}
              >
                Annuler
              </button>
            </>
          )}
        </div>
      )}

      {/* Rejoindre le combat — joueurs uniquement */}
      {!isDM && (
        <div className="card">
          {!showJoin ? (
            // Fix 1 : joueur déjà présent — masquer le bouton rejoindre, proposer uniquement compagnon
            alreadyInCombat ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <div style={{
                  textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)',
                  padding: '8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                }}>
                  ✓ Déjà dans le combat
                </div>
                <button
                  className="btn btn-secondary w-full"
                  onClick={() => { setJoinType('companion'); setShowJoin(true); }}
                >
                  🐾 Ajouter un compagnon
                </button>
              </div>
            ) : (
              <button className="btn btn-primary w-full" onClick={() => setShowJoin(true)}>
                ⚔️ Rejoindre le combat
              </button>
            )
          ) : (
            <>
              <h4 style={{
                fontFamily: 'var(--font-heading)', color: 'var(--text-secondary)',
                fontSize: '0.9rem', marginBottom: 'var(--space-sm)',
              }}>
                ⚔️ Rejoindre le combat
              </h4>

              {/* Fix 1 : masquer l'option personnage si le joueur est déjà dans le combat */}
              {!alreadyInCombat && (
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
              )}

              {/* Fix 3 : affichage CA supprimé — seuls les PV sont montrés */}
              {joinType === 'character' && myCharacter && !alreadyInCombat && (
                <div style={{
                  fontSize: '0.78rem', color: 'var(--text-muted)',
                  marginBottom: 'var(--space-sm)', padding: '6px 8px',
                  background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
                }}>
                  PV {myCharacter.hp_current ?? myCharacter.hp_max ?? '?'}/{myCharacter.hp_max ?? '?'}
                </div>
              )}

              {/* Fix 3 : champ CA supprimé du formulaire compagnon */}
              {joinType === 'companion' && (
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                  {/* Fix 2 : Entrée déclenche la soumission — bordure rouge si champ vide */}
                  <input
                    type="text"
                    placeholder="Nom du compagnon"
                    value={joinName}
                    onChange={e => setJoinName(e.target.value)}
                    onKeyDown={handleJoinKeyDown}
                    style={{ flex: 1, minWidth: '100px', borderColor: joinErrors.name ? '#f87171' : undefined }}
                  />
                  <input
                    type="number"
                    placeholder="PV act."
                    value={joinHp}
                    onChange={e => setJoinHp(e.target.value)}
                    onKeyDown={handleJoinKeyDown}
                    style={{ width: '64px', borderColor: joinErrors.hp ? '#f87171' : undefined }}
                  />
                  <input
                    type="number"
                    placeholder="PV max"
                    value={joinHpMax}
                    onChange={e => setJoinHpMax(e.target.value)}
                    onKeyDown={handleJoinKeyDown}
                    style={{ width: '64px' }}
                  />
                </div>
              )}

              {/* Fix 2 : messages d'erreur pour les champs compagnon */}
              {(joinErrors.name || joinErrors.hp) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
                  {joinErrors.name && (
                    <span style={{ color: '#f87171', fontSize: '0.72rem' }}>{joinErrors.name}</span>
                  )}
                  {joinErrors.hp && (
                    <span style={{ color: '#f87171', fontSize: '0.72rem' }}>{joinErrors.hp}</span>
                  )}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: 'var(--space-sm)' }}>
                <label>Initiative</label>
                {/* Fix 2 : Entrée déclenche la soumission — bordure rouge si champ vide */}
                <input
                  type="number"
                  placeholder="Résultat de votre jet d'initiative"
                  value={joinInit}
                  onChange={e => setJoinInit(e.target.value)}
                  onKeyDown={handleJoinKeyDown}
                  style={{ borderColor: joinErrors.initiative ? '#f87171' : undefined }}
                />
                {joinErrors.initiative && (
                  <span style={{ color: '#f87171', fontSize: '0.72rem', display: 'block', marginTop: '2px' }}>
                    {joinErrors.initiative}
                  </span>
                )}
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
                    setJoinName(''); setJoinInit(''); setJoinHp(''); setJoinHpMax('');
                    setJoinErrors({});
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
