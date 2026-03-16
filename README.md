# Plan My Dinner Card

Lovelace custom card per [Plan My Dinner](https://github.com/rikyru/planmydinner).

Mostra:
- **Navigazione giornaliera** — frecce ‹ › per scorrere i 7 giorni della settimana
- **Pranzo e cena del giorno selezionato** — click sul pasto per cambiare ricetta
- **Popup cambio ricetta** — carica 5 alternative dal backend e le applica al piano con un tap
- **Strip settimanale** — 7 punti colorati cliccabili (verde = pianificato, blu = oggi, grigio = passato)
- **Lista spesa** — contatore articoli + anteprima primi 5
- **Dispensa** — contatore articoli
- **Pulsanti azione** — Genera piano (algoritmo), Genera con AI, Apri UI

## Requisiti

- [Plan My Dinner](https://github.com/rikyru/planmydinner) — add-on + integrazione HA installati e configurati
- Sensori `sensor.plan_my_dinner_*` presenti in Home Assistant

## Installazione tramite HACS

1. **HACS → Frontend → ⋮ → Custom repositories**
2. Aggiungi `https://github.com/rikyru/planmydinner-card` come tipo **Lovelace**
3. Cerca "Plan My Dinner Card" e installa
4. Ricarica la cache del browser (hard refresh)

## Installazione manuale

1. Scarica `planmydinner-card.js` e copialo in `config/www/`
2. **Impostazioni → Dashboard → Risorse** → Aggiungi risorsa:
   - URL: `/local/planmydinner-card.js`
   - Tipo: Modulo JavaScript

## Utilizzo

```yaml
type: custom:planmydinner-card
title: "Piano Pasti"    # opzionale, default "Plan My Dinner"
show_week: true          # strip settimanale (default true)
show_shopping: true      # lista spesa + dispensa (default true)
show_actions: true       # pulsanti genera/apri UI (default true)
compact: false           # solo pasti, niente strip/spesa/azioni (default false)
```

### Esempio compatto

```yaml
type: custom:planmydinner-card
title: "Oggi"
compact: true
```

## Sensori utilizzati

| Sensore | Dati letti |
|---------|-----------|
| `sensor.plan_my_dinner_today` | `attributes.meals.pranzo` / `.cena` |
| `sensor.plan_my_dinner_week` | `attributes.days` (strip settimanale) |
| `sensor.plan_my_dinner_shopping` | `state` (contatore) + `attributes.items_by_category` |
| `sensor.plan_my_dinner_pantry` | `state` (contatore) |
| `sensor.plan_my_dinner_web_ui` | `state` (URL interfaccia web) |

## Servizi HA chiamati dai pulsanti

| Pulsante | Servizio |
|----------|---------|
| ⟳ Genera | `planmydinner.generate_week` |
| 🤖 AI | `planmydinner.generate_week_ai` |

## Editor visuale

La card supporta l'editor visuale di Lovelace: seleziona la card nell'interfaccia di editing per configurarla senza YAML.
