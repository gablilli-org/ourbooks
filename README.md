# 📚 ourbooks

node script per scaricare i tuoi ebook dalle piattaforme degli editori.

unisce e migliora alcuni script originali di @leone25 — enorme grazie a lui 🙌 senza il suo lavoro questo repo non esisterebbe.

## ✨ cosa fa
- 📥 scarica gli ebook dal tuo account
- 🛠️ integra e aggiorna script esistenti
- 🔄 supporta diverse piattaforme editoriali

## 🏫 piattaforme supportate
- 📘 hubscuola
- 📗 laterza
- 📕 booktab (zanichelli)
- 📙 sanoma

## 🚀 perché usarlo
- semplice da usare
- automatizza il download
- tutto in un unico posto

## ☁️ deploy su vercel

puoi deployare ourbooks su [Vercel](https://vercel.com) come web app con API serverless.

### deploy con un click

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/gablilli/ourbooks)

### deploy manuale

1. installa la [Vercel CLI](https://vercel.com/docs/cli):
   ```bash
   npm install -g vercel
   ```

2. fai il deploy:
   ```bash
   vercel
   ```

3. oppure collega il repo direttamente dalla [dashboard Vercel](https://vercel.com/new).

### API endpoints

una volta deployato, sono disponibili i seguenti endpoint:

| metodo | path | descrizione |
|--------|------|-------------|
| `GET` | `/api/providers` | lista le piattaforme supportate |
| `POST` | `/api/download` | avvia il download per una piattaforma |

**esempio `/api/download`:**
```json
POST /api/download
{
  "provider": "hubscuola",
  "platform": "hubyoung",
  "volumeId": "12345",
  "token": "il-tuo-token"
}
```

---

⚠️ usa questo progetto solo per scaricare contenuti a cui hai legalmente accesso.

buona lettura 📖✨