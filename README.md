# Quinté+ Analyzer

Analyse et pronostics pour les courses Quinté+ du PMU.

## Fonctionnalités

- Chargement automatique du Quinté+ du jour via l'API PMU
- Affichage détaillé des participants (jockey, entraîneur, propriétaire, sexe, âge, ferrure, œillères, musique)
- Analyse historique sur 90 jours (stats jockey/entraîneur)
- Score composite multi-critères
- Pronostic Top 5 + outsiders

## Installation

```bash
npm install
npm run dev
```

L'app sera disponible sur http://localhost:3000

## Stack

- React 18
- Vite
- API PMU (proxy CORS intégré via Vite)
