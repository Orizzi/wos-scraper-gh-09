# WOS Scraper - GitHub Actions Worker

Worker distribué pour scraping WOS utilisant GitHub Actions (compute illimité gratuit).

## 🚀 Architecture

- **20 workers parallèles** par repo
- **Cron toutes les 5 minutes** (12 runs/heure)
- **10 IDs par worker** = 200 IDs toutes les 5 minutes
- **Rate** : ~0.66 IDs/s par repo

## 📊 Performance

- 1 repo = +0.66 IDs/s
- 10 repos = **+6.6 IDs/s**
- 100 repos = **+66 IDs/s**

## 🔧 Setup

1. Fork ce repo (doit être PUBLIC pour compute illimité)
2. Le workflow se déclenche automatiquement toutes les 5 min
3. Ou lancer manuellement : Actions → Run workflow

## 📡 Communication avec serveur OVH

- **GET** `/api/get-batch?size=10&worker=gh-worker-X` — Demande IDs à scanner
- **POST** `/api/bulk-insert` — Envoie résultats

## ⚠️ Important

- Repo DOIT être **PUBLIC** pour compute illimité
- Repo privé = 2000 minutes/mois seulement

## 🔗 Plus d'infos

https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
