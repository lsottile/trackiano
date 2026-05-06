# Trackiano

Telegram bot que registra gastos en Notion.

## Uso

Mandá un mensaje al bot con el formato:
```
{descripcion} {monto} {categoria}
```
Ejemplo: `cafe 50 living`

## Comandos

- `/categorias` — lista todas las categorías disponibles
- `/saldo <categoria>` — muestra el saldo de una categoría
- `/resumen` — gastos del mes por categoría

## Setup

```bash
npm install
cp .env.example .env
# completar las variables en .env
node src/bot.js
```
