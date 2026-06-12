# 🐉 DND Session Manager

Application Full Stack de gestion de campagnes et de sessions de jeu de rôle **Donjons & Dragons (D&D)** en temps réel.

DND Session Manager permet aux Maîtres du Jeu (MJ) et aux joueurs de centraliser l'ensemble des outils nécessaires au déroulement d'une campagne : fiches de personnages, cartes interactives, suivi des combats, chat temps réel, wiki collaboratif, quêtes, lancers de dés et journal d'actions.

---

# ✨ Fonctionnalités principales

## 🔐 Authentification et gestion des utilisateurs

* Inscription et connexion sécurisées
* Authentification JWT
* Mots de passe chiffrés avec bcrypt
* Modification du profil utilisateur
* Gestion des avatars
* Mise à jour des pseudonymes en temps réel

---

## 🎲 Gestion des sessions

### Maître du Jeu

* Création de campagnes
* Génération automatique de codes d'invitation
* Suppression de campagnes
* Gestion des membres

### Joueurs

* Rejoindre une campagne via un code d'invitation
* Consultation des sessions auxquelles ils participent
* Présence en ligne en temps réel

---

## 📜 Fiches de personnages

Gestion complète des personnages :

* Nom
* Race
* Classe
* Niveau
* Points de vie
* Classe d'armure
* Initiative
* Bonus d'attaque
* Caractéristiques :

  * Force
  * Dextérité
  * Constitution
  * Intelligence
  * Sagesse
  * Charisme

Fonctionnalités avancées :

* Attribution d'un personnage à un joueur
* Synchronisation en temps réel
* Sauvegarde automatique
* Gestion de l'inventaire
* Gestion des compétences
* Gestion des capacités
* Historique et notes
* Import de fiches via PDF
* Transfert de personnages entre campagnes

---

## 🗺️ Carte interactive (Virtual Tabletop)

Système de carte temps réel intégré.

### Fonctionnalités

* Import d'images de cartes
* Déplacement de tokens en temps réel
* Synchronisation multi-utilisateurs
* Dessin collaboratif
* Curseurs visibles des autres joueurs
* Brouillard de guerre (Fog of War)
* Vision automatique des personnages
* Vision améliorée (Night Vision)
* Gestion des couches de dessin
* Mise à jour instantanée via Socket.IO

---

## ⚔️ Gestionnaire de combat

Outil dédié aux affrontements.

### Fonctionnalités

* Création d'initiatives

* Gestion des tours

* Gestion des rounds

* Ordre automatique des participants

* Gestion des monstres et PNJ

* Suivi des points de vie

* Conditions et états :

  * Empoisonné
  * Étourdi
  * Concentré
  * Charmé
  * Effrayé
  * Paralysé
  * Aveuglé
  * Sourd
  * Invisible
  * Entravé
  * Épuisé
  * Pétrifié
  * Inconscient

* Synchronisation temps réel pour tous les participants

---

## 🎲 Lanceur de dés

Support des expressions classiques D&D :

Exemples :

```text
1d20
2d6+3
4d8
1d100
```

Fonctionnalités :

* Historique des jets
* Résultats détaillés
* Calcul automatique des totaux
* Diffusion en temps réel
* Effets sonores

---

## 💬 Chat temps réel

Messagerie intégrée à chaque campagne.

### Fonctionnalités

* Messages publics
* Messages privés
* Historique persistant
* Affichage des utilisateurs connectés
* Commandes liées aux jets de dés
* Synchronisation Socket.IO

### Permissions

* Le MJ peut consulter tous les messages.
* Les joueurs ne voient que :

  * les messages publics ;
  * les messages privés qu'ils envoient ;
  * les messages privés qui leur sont destinés.

---

## 📖 Wiki collaboratif

Base de connaissances intégrée à la campagne.

### Catégories disponibles

* Général
* Monde
* PNJs
* Lieux
* Lore

### Fonctionnalités

* Création de pages
* Modification en temps réel
* Suppression
* Organisation par catégories
* Partage d'informations de campagne

---

## 📌 Gestion des quêtes

Suivi de l'avancement de l'aventure.

### Fonctionnalités

* Création de quêtes
* Modification
* Suppression
* Filtrage par statut
* Quêtes publiques
* Quêtes privées
* Suivi de progression

---

## 📋 Journal d'actions

Historique centralisé des événements importants :

* Création de personnages
* Modifications
* Lancers de dés
* Gestion de combat
* Activités de session
* Événements système

---

## 🔔 Notifications temps réel

* Événements de session
* Assignation de personnages
* Jets de dés
* Actions importantes
* Effets sonores intégrés

---

# 🏗️ Architecture du projet

```text
DnD/
│
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── utils/
│   │
│   └── public/
│
└── server/
    ├── routes/
    ├── middleware/
    ├── socket/
    ├── uploads/
    └── db.js
```

---

# 🛠️ Technologies utilisées

## Frontend

* React 19
* Vite
* Socket.IO Client
* JavaScript ES Modules

## Backend

* Node.js
* Express
* Socket.IO
* JWT
* bcryptjs

## Base de données

* SQLite
* better-sqlite3

## Uploads et fichiers

* Multer
* PDF Parse

---

# 🗄️ Base de données

Principales tables :

* users
* sessions
* session_members
* characters
* dice_rolls
* chat_messages
* maps
* combat_encounters
* quests
* wiki_pages
* action_logs

---

# 🚀 Installation

## 1. Cloner le projet

```bash
git clone <repository-url>
cd DnD
```

---

## 2. Installer le client

```bash
cd client
npm install
```

---

## 3. Installer le serveur

```bash
cd ../server
npm install
```

---

## 4. Configuration

### Client (.env)

```env
VITE_API_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
```

### Serveur (.env)

```env
JWT_SECRET=your_secret_key
PORT=3000
```

---

## 5. Lancer le serveur

```bash
cd server
npm run dev
```

ou

```bash
npm start
```

---

## 6. Lancer le client

```bash
cd client
npm run dev
```

---

# 🔌 Temps réel

La communication temps réel repose sur Socket.IO.

Événements principaux :

* connexion utilisateur
* présence en ligne
* messages de chat
* lancers de dés
* mises à jour des personnages
* mouvements de tokens
* dessins collaboratifs
* wiki
* notifications
* gestion des combats

---

# 🔒 Sécurité

* Authentification JWT
* Routes protégées
* Vérification des rôles
* Hashage des mots de passe avec bcrypt
* Validation des accès aux campagnes
* Isolation des données par session

---

# 📈 Objectifs du projet

DND Session Manager vise à fournir une plateforme légère et temps réel permettant à un groupe de joueurs de gérer l'ensemble d'une campagne de jeu de rôle sans dépendre de multiples outils externes.

L'application centralise :

* la préparation des campagnes ;
* la gestion des personnages ;
* les combats ;
* les cartes ;
* la documentation ;
* la communication entre joueurs.

---

# 📄 Licence

Projet réalisé à des fins pédagogiques et de développement logiciel.

Licence à définir selon les besoins du projet.
