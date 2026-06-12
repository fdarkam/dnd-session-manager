# 🐉 DND Session Manager

Application Full Stack de gestion de campagnes **Donjons & Dragons** avec Virtual Tabletop (VTT) temps réel.

Le projet permet à un Maître du Jeu (MJ) et à ses joueurs de gérer une campagne complète depuis une interface unique : cartes interactives, combats, fiches de personnages, quêtes, wiki collaboratif, chat temps réel et lancers de dés.

---

# ✨ Fonctionnalités

## 🗺️ Virtual Tabletop (VTT)

Le cœur de l'application repose sur un système de carte temps réel synchronisé via Socket.IO.

### Fonctionnalités disponibles

* Import et affichage de cartes
* Déplacement de tokens en temps réel
* Interpolation fluide (lerp)
* Grille de jeu configurable
* Brouillard de guerre (Fog of War)
* Vision automatique des personnages
* Dessin libre
* Outil gomme
* Formes tactiques :

  * Cercle
  * Rectangle
  * Ligne
  * Cône
* Synchronisation multi-utilisateurs
* Mise à jour temps réel des positions

---

## 🎭 Gestion des tokens

Chaque token peut être lié à un personnage de campagne.

### Données gérées

* Nom
* Position
* Points de vie
* Apparence
* Conditions D&D
* Vision
* Liaison avec une fiche de personnage

### Conditions D&D supportées

* Aveuglé
* Charmé
* Assourdi
* Effrayé
* Agrippé
* Incapacités
* Invisible
* Paralysé
* Pétrifié
* Empoisonné
* À terre
* Étourdi

Les conditions sont centralisées dans :

```text
src/domain/conditions.js
```

Chaque condition possède :

* un identifiant technique
* un libellé français
* un emoji
* une couleur associée

---

## ⚔️ Combat Tracker

Gestion complète des combats.

### Fonctionnalités

* Initiative
* Ordre des tours
* Gestion des rounds
* Suivi des points de vie
* Conditions actives
* Synchronisation temps réel
* Mise à jour instantanée pour tous les joueurs

---

## 📜 Fiches de personnage

Gestion complète des personnages D&D.

### Caractéristiques

* Force
* Dextérité
* Constitution
* Intelligence
* Sagesse
* Charisme

### Fonctionnalités

* Création
* Modification
* Attribution à un joueur
* Liaison avec un token
* Export JSON
* Import JSON
* Import PDF

---

## 🎲 Lancers de dés

Support des expressions classiques de Donjons & Dragons.

### Exemples

```text
1d20
2d6+3
4d8
1d100
```

### Fonctionnalités

* Historique des jets
* Résultats détaillés
* Diffusion temps réel
* Intégration au journal d'actions

---

## 💬 Chat temps réel

Messagerie intégrée à chaque session.

### Fonctionnalités

* Messages instantanés
* Synchronisation Socket.IO
* Historique persistant
* Affichage des utilisateurs connectés

---

## 📖 Wiki collaboratif

Documentation partagée de la campagne.

### Utilisation

* Lore
* PNJ
* Lieux
* Factions
* Notes de campagne

### Fonctionnalités

* Création
* Modification
* Consultation collaborative

---

## 📌 Gestionnaire de quêtes

Suivi des objectifs de campagne.

### Fonctionnalités

* Création de quêtes
* Modification
* Suivi de progression
* Historique

---

## 📋 Journal d'actions

Historique centralisé des événements importants :

* Lancers de dés
* Combats
* Modifications de personnages
* Gestion des cartes
* Actions de session

---

## 🔐 Authentification

Authentification sécurisée basée sur JWT.

### Fonctionnalités

* Inscription
* Connexion
* Gestion de session
* Sessions multiples
* Persistance utilisateur

---

## 👑 Gestion des rôles

Deux rôles principaux sont disponibles :

### Maître du Jeu

* Gestion complète de la session
* Contrôle de la carte
* Gestion des combats
* Gestion des personnages
* Administration des contenus

### Joueur

* Accès limité selon les permissions accordées
* Contrôle de son personnage
* Participation aux combats
* Interaction avec les outils de session

---

# 🏗️ Architecture Frontend

```text
client/src/
├── api/
│   └── client.js
│
├── domain/
│   └── conditions.js
│
├── hooks/
│   └── useDraggable.js
│
├── components/
│   ├── common/
│   │   └── FloatingPanel.jsx
│   │
│   ├── map/
│   │   ├── MapCanvas.jsx
│   │   ├── MapToolbar.jsx
│   │   ├── TokenOverlay.jsx
│   │   ├── TokenEditPanel.jsx
│   │   ├── TokenInfoPanel.jsx
│   │   ├── geometry.js
│   │   │
│   │   ├── drawing/
│   │   │   ├── drawFrame.js
│   │   │   └── drawShape.js
│   │   │
│   │   └── hooks/
│   │       ├── useMapRefs.js
│   │       ├── useMapSocket.js
│   │       ├── useMapInput.js
│   │       ├── useLerpAnimation.js
│   │       ├── useFog.js
│   │       ├── useUndoRedo.js
│   │       └── useMapData.js
│   │
│   ├── CharacterSheet.jsx
│   ├── CombatTracker.jsx
│   ├── ChatPanel.jsx
│   ├── DiceRoller.jsx
│   ├── QuestTracker.jsx
│   ├── WikiPanel.jsx
│   ├── ActionLog.jsx
│   └── Notifications.jsx
│
├── contexts/
│   ├── AuthContext.jsx
│   └── SocketContext.jsx
│
└── pages/
    ├── SessionPage.jsx
    ├── DashboardPage.jsx
    └── LoginPage.jsx
```

---

# ⚡ Architecture VTT

## MapCanvas

`MapCanvas` agit comme orchestrateur principal.

Responsabilités :

* Gestion du rendu
* Coordination des hooks spécialisés
* Synchronisation des données de carte
* Communication avec le moteur de dessin

---

## useMapRefs

Hook central du moteur temps réel.

### Responsabilités

* Stockage des références critiques
* Synchronisation état ↔ références
* Support du rendu 60 FPS
* Évitement des re-renders inutiles

---

## useMapInput

Gestion des interactions utilisateur :

* souris
* drag & drop
* zoom
* pan
* dessin

Conçu pour le chemin critique d'exécution temps réel.

---

## useMapSocket

Gestion de la synchronisation réseau.

Responsabilités :

* Enregistrement des événements Socket.IO
* Réception des mises à jour
* Diffusion des actions utilisateur

---

## useLerpAnimation

Interpolation des déplacements.

Permet :

* mouvements fluides
* réduction des saccades réseau
* meilleure perception des déplacements

---

## useFog

Gestion :

* du brouillard de guerre
* des zones visibles
* de la vision automatique

---

## useUndoRedo

Historique local des actions :

* annulation
* restauration

---

# 🔒 Invariants techniques

## Pattern Ref / State miroir

Le moteur de carte repose sur un système de synchronisation entre états React et références.

Objectifs :

* stabilité du rendu
* suppression des ralentissements
* compatibilité temps réel

Cet invariant doit être conservé.

---

## drawFrame

Le moteur de rendu suit une règle stricte :

```text
drawFrame
    ↓
lecture des refs uniquement
    ↓
aucune lecture directe des states React
```

Cette contrainte garantit des performances constantes lors du rendu.

---

## Socket.IO

Les listeners de `useMapSocket` sont appairés :

```javascript
socket.on(event, handler);

// cleanup

socket.off(event, handler);
```

Toute modification doit préserver cet équilibre afin d'éviter :

* fuites mémoire
* doublons d'événements
* désynchronisations

---

## API Client

Toutes les communications HTTP transitent exclusivement par :

```text
src/api/client.js
```

Aucun appel réseau direct ne doit être effectué depuis les composants.

Cette couche centralise :

* l'authentification JWT
* la gestion des erreurs
* les appels backend

---

# 🛠️ Technologies

## Frontend

* React
* Vite
* Socket.IO Client
* JavaScript ES Modules

## Backend

* Node.js
* Express
* Socket.IO

## Base de données

* SQLite
* better-sqlite3

## Authentification

* JWT

---

# 🚀 Lancement du projet

## Installation des dépendances

```bash
npm install
```

## Frontend

```bash
npm run dev
```

## Backend

```bash
npm start
```
ou
```bash
npm run dev
```
---

# 🎯 Objectif du projet

DND Session Manager vise à fournir une plateforme unifiée permettant de gérer l'intégralité d'une campagne de jeu de rôle :

* cartes tactiques temps réel ;
* combats ;
* personnages ;
* documentation ;
* communication ;
* suivi de progression.

L'application met l'accent sur la fluidité du Virtual Tabletop, la synchronisation temps réel et la centralisation des outils utilisés lors d'une partie de Donjons & Dragons.
