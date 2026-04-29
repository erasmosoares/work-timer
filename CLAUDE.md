# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

```bash
pip install flask        # one-time setup
python app.py            # starts server at http://localhost:5001
```

Port 5000 is reserved by macOS AirPlay Receiver; the app uses **5001**.

## Architecture

This is a single-user local work-time tracker. The Flask backend (`app.py`) serves a single-page dashboard and exposes a REST API. All persistence goes through `database.py` (SQLite, file `worktime.db` next to the source). The frontend (`static/app.js`) is vanilla JS with no build step.

### Timer state machine

State is derived entirely from the database — there is no in-memory state on the server. A row in `work_sessions` with `end_time IS NULL` is the active session; its `session_type` determines state:

- no open row → `idle`
- open `work` row → `working`
- open `break` row → `break`

Transitions: `idle → working` (start), `working → break` (pause), `break → working` (resume), `working/break → idle` (stop). Each transition closes the current open row and optionally inserts a new one.

### Time accumulation

`get_day_seconds()` sums all `work`-type sessions for today, using `now` as the end time for the active (open) session. The frontend calls `GET /api/status` on load to restore state; it subtracts the live segment from `elapsed_seconds_today` to avoid double-counting as the JS tick runs forward.

### Alert thresholds (frontend only)

Alerts fire once per threshold crossing using boolean flags (`alertFired30`, `alertFired10`, `alertFiredDone`). These reset when settings are saved. Sound is generated via Web Audio API — no audio files.

### Config

Stored as key/value rows in the `config` table. Valid keys: `daily_hours`, `weekly_hours`, `alert_minutes`. Monthly goal is calculated at runtime: `get_month_working_days() × daily_hours`.

## API summary

| Method | Path | Description |
|---|---|---|
| GET | `/api/status` | State + today's elapsed seconds + active session start |
| POST | `/api/sessions/start` | idle → working |
| POST | `/api/sessions/pause` | working → break |
| POST | `/api/sessions/resume` | break → working |
| POST | `/api/sessions/stop` | any → idle |
| GET/PUT | `/api/config` | Read or update settings |
| GET | `/api/progress/day` | Today's work seconds |
| GET | `/api/progress/week` | ISO week's work seconds |
| GET | `/api/progress/month` | Month's work seconds + working_days count |
