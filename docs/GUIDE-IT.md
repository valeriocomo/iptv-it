# TV live italiana su Jellyfin con la playlist IPTV-Italia Plus

_Aggiornata al 31 ottobre 2026_

## Panoramica

Con questi sei passi ottieni in Jellyfin oltre 70 canali italiani in chiaro (RAI, Mediaset, La7, Discovery, tematici e radio-TV) con la guida TV, usando la playlist `iptvitaplus.m3u` di Tundrak.

La playlist non contiene un link alla guida TV e usa quattro tipi di flusso, ognuno con esigenze diverse:

| Gruppo | Esempi | Tipo di flusso | Cosa serve |
| --- | --- | --- | --- |
| RAI | Rai 1, Rai 2, Rai 3, Rai News 24 | Relinker mediapolis.rai.it, poi HLS | IP italiano e User-Agent `HbbTV/1.6.1` |
| Mediaset | Rete 4, Canale 5, Italia 1, TGCOM 24 | DASH (`.mpd`) in chiaro | User-Agent `HbbTV/1.6.1` |
| Discovery, La7 e altri | NOVE, Real Time, DMAX, La7, TV2000 | HLS (`.m3u8`) | Niente di particolare |
| Sky in chiaro | TV8, Cielo, Sky TG24 | HLS con token | Token che scade: il link viene rinnovato al Passo 1 |

Prerequisiti:

- Jellyfin 10.9 o successivo (i nomi delle opzioni cambiano un po' tra versioni)
- Server che esce su internet con un IP italiano, indispensabile per i canali RAI
- Un repository GitHub pubblico e, sul tuo computer, Docker (oppure Node.js 18+ e yt-dlp) per generare la playlist al Passo 1
- Facoltativo: Docker sul tuo computer per controllare la guida TV al Passo 3 (la genera GitHub Actions)
- Facoltativo: Docker per Threadfin al Passo 6

## Passo 1 — Genera la playlist sul tuo computer

Il generatore scarica la playlist di Tundrak, rinnova i link di TV8, Cielo e Sky TG24 con yt-dlp, prova ogni link con lo stesso User-Agent di Jellyfin (`HbbTV/1.6.1`) e scrive il risultato in `public/iptvitaplus.m3u` nel tuo repository GitHub. Lo lanci a mano ogni volta che vuoi aggiornare la lista.

Lancialo da una rete italiana, possibilmente la stessa del server Jellyfin: le dirette Sky sono visibili solo dall'Italia.

**A. Prepara il repository** (una volta sola). Il repository è [valeriocomo/iptv-it](https://github.com/valeriocomo/iptv-it) e deve essere pubblico. Clonalo sul tuo computer:

```bash
git clone https://github.com/valeriocomo/iptv-it.git
```

**B. Prepara il generatore** (una volta sola). Metti nel clone del repository la cartella `packages/playlist` (`Dockerfile`, `entrypoint.sh`, `generate-playlist.js`), il file `compose.yml` e `README.md`. Il `compose.yml` monta la sua stessa cartella e la playlist viene scritta in `public/iptvitaplus.m3u`, con lo stesso nome del file di Tundrak; la cartella `public` viene creata se manca. Poi costruisci l'immagine:

```bash
docker compose build
```

**C. Genera la playlist** (ogni volta che vuoi aggiornarla):

```bash
docker compose run --rm playlist-generator
```

Ogni esecuzione aggiorna anche yt-dlp e alla fine stampa un riepilogo, per esempio "Done: 71 channels written (Sky: 3 updated, 0 not updated)".

| Messaggio | Significato |
| --- | --- |
| `Updated: TV8` | Link Sky rinnovato |
| `  reason: ERROR: …` | Sotto ogni "Not updated": l'errore restituito da yt-dlp |
| `Replaced: NOVE (ENOTFOUND) -> https://… [iptv-org]` | Il link di Tundrak non risponde: è stato sostituito con uno ufficiale funzionante (`[RAI relinker]` o `[iptv-org]`) |
| `Not working, no official alternative found` | Canali il cui link non risponde e senza alternative ufficiali funzionanti; restano nella playlist, oppure vengono tolti con `REMOVE_NOT_WORKING=1` |
| `… unofficial alternative(s) ignored` | iptv-org aveva link per quel canale, ma solo su server di ritrasmissione di terzi |
| `Links: 60 working, 8 replaced, 3 not working` | Riepilogo della prova dei link |
| `Not updated: … (keeping the link from the previous run)` | yt-dlp non ha trovato un link nuovo: resta quello della generazione precedente |
| `Not updated: … (keeping the link from the upstream playlist)` | Nessun link nuovo né precedente: quel canale probabilmente non funziona |
| `Error: … The output file was not changed.` | Download o yt-dlp non riusciti: il file non è stato toccato |

La lista di Tundrak non viene più aggiornata e molti link sono cambiati. Per questo il generatore apre ogni link come farebbe Jellyfin: se non risponde con un flusso HLS o DASH entro 10 secondi, cerca un'alternativa ufficiale funzionante. Per i canali RAI prova lo stesso relinker senza i vecchi parametri, che oggi rispondono 503; per gli altri cerca nella lista di [iptv-org](https://github.com/iptv-org/iptv), verificata ogni giorno, scartando le ritrasmissioni di terzi: server su indirizzi IP o porte non standard, e server che trasmettono canali di emittenti diverse (per esempio La7 e RAI insieme), perché un server ufficiale trasmette solo i canali della propria emittente. Se un canale supera la prova ma Jellyfin non lo riproduce, il problema è in Jellyfin (User-Agent, FFmpeg) e non nel link.

Il supporto di yt-dlp è confermato per la diretta di TV8; per Cielo e Sky TG24 non è verificato. Se restano "Not updated", per quei canali c'è il digitale terrestre (canali 26 e 50).

Su Linux il container scrive il file come utente 1000. Se `id -u` ti dà un numero diverso, lancialo così:

```bash
PUID=$(id -u) PGID=$(id -g) docker compose run --rm playlist-generator
```

Senza Docker serve Node.js 18 o successivo e yt-dlp (`pip install -U yt-dlp`); poi, dalla cartella del clone, lanci `node packages/playlist/generate-playlist.js public` (oppure `npm run start -w @iptv-it/playlist`).

## Passo 1b — Pubblica la playlist su GitHub

Dopo ogni generazione carichi il file sul repository e Jellyfin lo legge dal suo link pubblico.

```bash
cd iptv-it
git add public/iptvitaplus.m3u
git commit -m "Update playlist"
git pull --rebase
git push
```

Se `git commit` risponde "nothing to commit", la playlist non è cambiata e non c'è niente da pubblicare. `git pull --rebase` scarica prima gli aggiornamenti della guida che GitHub Actions carica sul repository (Passo 3); senza, il push può essere rifiutato.

L'indirizzo da dare a Jellyfin è l'URL raw del file:

```
https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u
```

Aprilo nel browser per controllare: deve mostrare il testo della playlist. GitHub tiene il file in cache per circa 5 minuti, quindi dopo un push le modifiche possono arrivare con qualche minuto di ritardo.

Il repository è pubblico: chiunque può vedere la playlist, compresi i link Sky con il token.

## Passo 2 — Aggiungi il sintonizzatore M3U

L'impostazione decisiva è lo User-Agent `HbbTV/1.6.1`: senza, RAI e Mediaset rifiutano il collegamento.

1. Apri **Dashboard → TV in diretta**.
2. Accanto a **Dispositivi sintonizzatore** premi **+**.
3. Compila i campi così:

| Campo | Valore | Note |
| --- | --- | --- |
| Tipo sintonizzatore | M3U Tuner |  |
| File o URL | `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u` | L'URL raw del Passo 1b |
| User agent | `HbbTV/1.6.1` | Vale per tutti i canali; agli altri non dà fastidio |
| Limite flussi simultanei | 0 | 0 = nessun limite |
| Consenti condivisione del flusso | Attivo | Più dispositivi sullo stesso canale usano un solo flusso |
| Ignora timestamp DTS | Disattivo | Attivalo solo se vedi scatti o audio fuori sincrono |
| Leggi input al frame rate nativo | Disattivo |  |

4. Premi **Salva**. I canali compaiono nella sezione TV in diretta dopo qualche secondo.

Jellyfin non applica in modo affidabile le righe `#EXTVLCOPT` canale per canale: per questo lo User-Agent va messo nel sintonizzatore. Se la tua versione non mostra il campo User agent, passa direttamente al Passo 6.

## Passo 3 — Genera la guida TV

Il generatore della guida legge la playlist del Passo 1, abbina ogni canale a una fonte italiana di iptv-org/epg e scrive `public/guide.xml`. Una GitHub Action lo esegue sui server di GitHub e pubblica la guida da sola (C); sul tuo computer lo esegui in Docker solo per controllare il risultato.

Nella guida ogni canale ha lo stesso ID della playlist (`Rai1.it`, `Canale5.it`…), quindi Jellyfin li abbina da solo. L'abbinamento serve perché iptv-org oggi usa ID diversi, come `Rai1.it@SD`.

**A. Prepara il generatore** (una volta sola, solo per usarlo sul tuo computer). Il generatore è nella cartella `packages/epg` del repository (`Dockerfile`, `entrypoint.sh`, `generate-epg.js`) ed è il servizio `epg-generator` del `compose.yml`. Costruisci l'immagine:

```bash
docker compose build epg-generator
```

**B. Genera la guida sul tuo computer** (facoltativo, per controllarla), sempre dopo la playlist:

```bash
docker compose run --rm playlist-generator
docker compose run --rm epg-generator
```

In alternativa, con Node.js installato: `npm run start -w @iptv-it/epg`. Lo script ricostruisce l'immagine, poi lancia lo stesso servizio con il tuo utente.

Su Linux, se `id -u` non restituisce 1000, anteponi `PUID=$(id -u) PGID=$(id -g)` a entrambi i comandi, come al Passo 1.

Ogni esecuzione aggiorna i lettori dei siti di iptv-org/epg, che cambiano spesso; lo scaricamento richiede qualche minuto. Il riepilogo elenca i canali abbinati con la fonte di ciascuno, per esempio `Rai1.it <- raiplay.it "RAI 1" (by id)`, poi quelli senza fonte. Se lo scaricamento non produce nessun programma, `public/guide.xml` non viene toccato.

| Fonte | Canali |
| --- | --- |
| raiplay.it | Canali RAI |
| mediasetinfinity.mediaset.it | Canali Mediaset |
| superguidatv.it | La7, Discovery, Sky in chiaro e gli altri |

Con la playlist attuale vengono abbinati 58 canali su 71; i 13 restanti sono radio-TV e canali minori che le fonti non coprono (BOM Channel, Padre Pio TV, Byoblu, RTV San Marino e simili). Abbinato però non vuol dire con programmi: nella guida generata il 31 ottobre 2026 superguidatv.it non ha restituito nulla, e hanno programmi solo RAI e Mediaset (25 canali). Se succede anche a te, cambia l'ordine delle fonti con la variabile `SITES` (sotto), mettendo guidatv.sky.it e guida.tv prima di superguidatv.it.

Per controllare l'abbinamento senza scaricare nulla:

```bash
docker compose run --rm epg-generator --match-only
```

**C. Pubblicala.** Lo fa per te la GitHub Action del repository (`.github/workflows/epg.yml`): ogni 6 ore, e ogni volta che fai push di una modifica alla playlist, a `compose.yml` o alla cartella `packages/epg`, rigenera la guida sui server di GitHub e fa il commit di `public/guide.xml` solo se è cambiato. Le fonti forniscono 2 o 3 giorni di programmi, quindi senza questi aggiornamenti in Jellyfin la guida resterebbe vuota.

Non fare il commit della guida generata sul tuo computer: scartala con `git checkout public/guide.xml`, tanto l'action la sostituirebbe al giro successivo. Per aggiornare la guida subito, apri la scheda **Actions** del repository → **Update TV guide** → **Run workflow**.

Se la nuova guida ha meno della metà dei programmi di quella nel repository (per esempio perché una fonte risponde peggio dai server di GitHub, che non sono in Italia), l'action non fa il commit e l'esecuzione fallisce con un errore nella scheda **Actions**. Per pubblicarla comunque, avviala a mano spuntando **force**.

**D. Aggiungila a Jellyfin:**

1. **Dashboard → TV in diretta → Fornitori dati guida → + → XMLTV**.
2. In **File o URL** inserisci `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/guide.xml`.
3. Abilita il fornitore per il sintonizzatore creato al Passo 2 e salva.

Per cambiare il comportamento, aggiungi le variabili nella sezione `environment` del servizio `epg-generator` nel `compose.yml` (`DAYS` e `MAX_CONNECTIONS` ci sono già, commentate). L'action usa lo stesso `compose.yml`, quindi dopo il push le modifiche valgono anche per lei:

| Variabile | Predefinito | Significato |
| --- | --- | --- |
| `DAYS` | quello di ogni fonte (2–3) | Giorni di programmi da scaricare |
| `MAX_CONNECTIONS` | `5` | Richieste in parallelo ai siti |
| `SITES` | `raiplay.it,mediasetinfinity.mediaset.it,superguidatv.it,guidatv.sky.it,guida.tv` | Fonti da usare, in ordine di preferenza |

Per esempio, per preferire guidatv.sky.it a superguidatv.it:

```yaml
      - SITES=raiplay.it,mediasetinfinity.mediaset.it,guidatv.sky.it,guida.tv,superguidatv.it
```

## Passo 4 — Aggiorna la guida e abbina i canali

Jellyfin abbina da solo i canali alla guida tramite il `tvg-id`; quelli rimasti senza programmi li colleghi a mano.

1. Vai in **Dashboard → Attività pianificate**, trova **Aggiorna guida** e avvialo. La prima volta può richiedere qualche minuto.
2. Apri la guida TV da un client: i canali con i programmi sono già abbinati.
3. Per gli altri torna in **Dashboard → TV in diretta**, apri il menu (⋮) del fornitore XMLTV e scegli **Mappa canali**.
4. Associa ogni canale della playlist alla voce corrispondente della guida, salva e avvia di nuovo **Aggiorna guida**.

I canali radio-TV e alcuni tematici potrebbero non avere una guida: è normale e non impedisce la visione.

## Passo 5 — Prova i canali chiave

Quattro canali bastano a capire se tutta la configurazione funziona; provali in quest'ordine.

| Ordine | Canale | Cosa verifica | Se non parte |
| --- | --- | --- | --- |
| 1 | La7 | Il sintonizzatore legge la playlist | Guarda nel riepilogo del Passo 1 se il link risulta funzionante o sostituito; poi apri l'URL raw nel browser e controlla che il repository sia pubblico (Passo 1b) |
| 2 | NOVE | I flussi HLS normali | Rigenera e ripubblica la playlist: il generatore sostituisce i link che non rispondono |
| 3 | Canale 5 | Flussi DASH Mediaset e User-Agent | Controlla lo User-Agent, poi passa al Passo 6 |
| 4 | Rai 1 | Relinker RAI, IP italiano e User-Agent | Rigenera la playlist; se resta tra i "Not working", verifica l'IP del server, poi passa al Passo 6 |

Per capire se il problema RAI è l'IP, lancia questo comando dal server:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -L -A "HbbTV/1.6.1" \
  "http://mediapolis.rai.it/relinker/relinkerServlet.htm?cont=2606803&output=7&forceUserAgent=raiplayappletv"
```

Se risponde `200` il flusso è raggiungibile e il problema sta in Jellyfin. Se risponde `403`, il server non esce con un IP italiano oppure la RAI ha cambiato qualcosa.

## Passo 6 (facoltativo) — Threadfin come intermediario

Se RAI o Mediaset non partono anche con lo User-Agent giusto, Threadfin si mette tra la playlist e Jellyfin e gestisce lui i flussi con FFmpeg e un buffer. Jellyfin lo vede come un sintonizzatore HDHomeRun.

**A. Avvia Threadfin** con questo `docker-compose.yml`:

```yaml
services:
  threadfin:
    image: fyb3roptik/threadfin:latest
    container_name: threadfin
    ports:
      - "34400:34400"
    volumes:
      - ./threadfin/conf:/home/threadfin/conf
    environment:
      - TZ=Europe/Rome
    restart: unless-stopped
```

```bash
docker compose up -d
```

**B. Configuralo** dall'interfaccia web su `http://<ip>:34400/web`:

1. Nella procedura iniziale scegli **HDHomeRun** come tipo di sintonizzatore.
2. In **Playlist** aggiungi `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/iptvitaplus.m3u`.
3. In **XMLTV** aggiungi `https://raw.githubusercontent.com/valeriocomo/iptv-it/refs/heads/main/public/guide.xml`.
4. In **Settings** imposta il buffer su **FFmpeg** e lo User-Agent su `HbbTV/1.6.1`.
5. In **Mapping** attiva i canali che vuoi e assegna a ciascuno la sua voce della guida.

**C. Collegalo a Jellyfin:**

1. In **Dashboard → TV in diretta** elimina il sintonizzatore M3U del Passo 2 e il fornitore XMLTV del Passo 3.
2. Aggiungi un sintonizzatore di tipo **HDHomeRun** con indirizzo `http://<ip>:34400`.
3. Aggiungi un fornitore **XMLTV** con l'URL della guida di Threadfin: `http://<ip>:34400/xmltv/threadfin.xml`.
4. Avvia di nuovo **Aggiorna guida**.

I nomi esatti delle voci di menu di Threadfin possono variare leggermente tra versioni.

## Risoluzione problemi

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Nessun canale nella TV in diretta | Jellyfin non riesce a scaricare la playlist | Apri l'URL raw nel browser: deve mostrare la playlist e il repository deve essere pubblico |
| Jellyfin mostra ancora i link vecchi | Cache di GitHub o lista non riletta | Aspetta 5 minuti dopo il push, poi avvia **Aggiorna guida** |
| Solo i canali RAI non partono | IP non italiano o User-Agent mancante | Fai il test `curl` del Passo 5, poi prova Threadfin |
| Solo i canali Mediaset non partono | FFmpeg di Jellyfin non gestisce bene i flussi DASH | Threadfin con buffer FFmpeg (Passo 6) |
| I canali partono e si bloccano dopo pochi secondi | Timestamp del flusso irregolari | Attiva **Ignora timestamp DTS**; se non basta, Threadfin |
| Guida vuota | Guida non aggiornata o `tvg-id` diversi | Avvia **Aggiorna guida** e abbina a mano (Passo 4) |
| Guida non aggiornata da più di 6 ore | La GitHub Action è fallita o è stata disattivata | Nella scheda **Actions** leggi l'errore dell'ultima esecuzione di **Update TV guide**, oppure riattiva il workflow |
| Un singolo canale smette di funzionare | L'emittente ha cambiato il link | Rigenera e ripubblica la playlist (Passi 1 e 1b) |
| TV8, Cielo o Sky TG24 non vanno | Token scaduto o yt-dlp senza link nuovo | Rigenera la playlist; se resta "Not updated", usa il digitale terrestre |

## Fonti

- [Playlist IPTV-Italia Plus (Tundrak)](https://raw.githubusercontent.com/Tundrak/IPTV-Italia/main/iptvitaplus.m3u)
- [Segnalazioni degli errori 403 sui canali RAI](https://github.com/Tundrak/IPTV-Italia/issues/119)
- [iptv-org/epg, strumento per la guida TV](https://github.com/iptv-org/epg)
- [Jellyfin Live TV & IPTV Setup 2026 (JellyWatch)](https://jellywatch.app/blog/jellyfin-live-tv-iptv-setup-guide-2026)
- [Jellyfin Live TV senza sintonizzatore: Threadfin e Dispatcharr (JellyWatch)](https://jellywatch.app/blog/jellyfin-m3u-tuner-live-tv-without-hardware-threadfin-dispatcharr-2026)
- [Forum Jellyfin: IPTV non compatibili e proxy](https://forum.jellyfin.org/printthread.php?tid=10304)