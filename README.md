# ourbooks

Tool per scaricare ebook dalle piattaforme degli editori tramite UI web o CLI.

## Piattaforme supportate
- hubscuola
- laterza (dibook)
- zanichelli (booktab)
- sanoma
- bsmart

## Avvio locale

1. Installa dipendenze:

```bash
npm install
```

2. Avvia il server UI:

```bash
npm run start
```

3. Apri:

```text
http://localhost:3000
```

## Deploy su Render (UI inclusa)

Il repo include configurazione pronta per Render con Docker:
- `Dockerfile`
- `render.yaml`

### Metodo rapido
1. Crea un nuovo Web Service su Render collegando il repository.
2. Render rilevera `render.yaml` e usera runtime Docker.
3. Deploy automatico: al termine avrai la UI disponibile sull'URL del servizio.

### Note tecniche
- Laterza richiede `pdftk` + Java: il Dockerfile li installa gia.
- Le API della UI sono servite direttamente da `server.js`.

## CLI

Esempio:

```bash
npm run cli -- --provider sanoma --id "mail@example.com" --password "..." --gedi "..."
```

⚠️ Usa questo progetto solo per contenuti a cui hai legalmente accesso.