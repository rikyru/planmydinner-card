# Plan My Dinner Card

Lovelace custom card per [Plan My Dinner](https://github.com/rikyru/planmydinner) — mostra i pasti del giorno (pranzo e cena), il conteggio della lista della spesa e un link diretto all'interfaccia web.

![Card preview](preview.png)

## Requisiti

- [Plan My Dinner Add-on](https://github.com/rikyru/planmydinner) installato e configurato
- Integrazione `planmydinner` attiva in Home Assistant (i sensori devono essere presenti)

## Installazione tramite HACS

1. In HACS → **Frontend** → menu ⋮ → **Custom repositories**
2. Aggiungi `https://github.com/rikyru/planmydinner-card` come tipo **Lovelace**
3. Cerca "Plan My Dinner Card" e installala
4. Ricarica la cache del browser

## Installazione manuale

1. Scarica `planmydinner-card.js` e copialo in `config/www/`
2. In **Impostazioni → Dashboard → Risorse** aggiungi:
   - URL: `/local/planmydinner-card.js`
   - Tipo: Modulo JavaScript

## Utilizzo

```yaml
type: custom:planmydinner-card
title: "Pasti di oggi"   # opzionale
```

## Sensori richiesti

La card legge automaticamente i sensori con prefisso `sensor.plan_my_dinner_`:

| Sensore | Contenuto |
|---------|-----------|
| `sensor.plan_my_dinner_today` | Pranzo e cena del giorno corrente |
| `sensor.plan_my_dinner_shopping` | Numero di prodotti in lista spesa |
| `sensor.plan_my_dinner_web_ui` | URL dell'interfaccia web |
