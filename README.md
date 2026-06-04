# cool_weather Weather App

A simple Docker Compose-based weather app with a Python backend, PostgreSQL persistence, and a static frontend.

## Features

- Serves a static frontend from `cool_weather/static`
- Fetches weather data from Open-Meteo
- Uses browser geolocation with IP fallback
- Saves search history to PostgreSQL
- Exposes dynamic app config from the backend

## Files

- `app.py` - Python backend server
- `Dockerfile` - Docker image build for the backend
- `compose.yml` - Docker Compose configuration for backend + Postgres
- `requirements.txt` - Python dependencies
- `config.json` - Runtime app configuration for cities and API settings
- `static/index.html` - Frontend HTML
- `static/script.js` - Frontend JavaScript
- `static/style.css` - Frontend styles
- `.env` - environment variables for Compose and backend

## Setup

1. Open a terminal in `cool_weather`.
2. Ensure `.env` contains the required environment variables.
3. Build and start the app:

```bash
docker compose up --build
```

4. Open `http://127.0.0.1:8000` in your browser.

## Environment variables

The backend expects these values from `.env` or the container environment:

- `HOST` - server bind address (e.g. `0.0.0.0`)
- `PORT` - server port (e.g. `8000`)
- `DB_HOST` - Postgres hostname (e.g. `db`)
- `DB_PORT` - Postgres port (e.g. `5432`)
- `DB_USER` - Postgres user
- `DB_PASSWORD` - Postgres password
- `DB_NAME` - Postgres database name

Optional runtime config can be overridden via `config.json` or environment variables:

- `WEATHER_API_BASE`
- `WEATHER_API_PARAMS`
- `IP_LOCATION_URL`
- `WEATHER_CITIES`
- `TIMEZONE_CITY_MAP`
- `HISTORY_LIMIT`

## Notes

- The backend proxy route `/ip-location` returns location details from the configured IP service.
- The frontend requests `/api/config` to populate cities and API settings dynamically.
- The history API is available at `/api/history`.
