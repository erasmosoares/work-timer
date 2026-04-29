# Work Timer

A local work-time tracker with a live timer, session calendar, progress summaries, and annual PDF reports. Runs entirely on your machine — no accounts, no cloud, no dependencies beyond Flask.

![Python](https://img.shields.io/badge/python-3.11+-blue) ![Flask](https://img.shields.io/badge/flask-3.0+-lightgrey) ![SQLite](https://img.shields.io/badge/storage-sqlite-green)

---

## Features

- **Live timer** — Start, pause (break), resume, and stop work sessions. The timer persists across page refreshes.
- **Daily / weekly / monthly progress** — Progress bars show how close you are to your configured goals.
- **Earnings tracking** — Set an hourly rate and see how much you've earned today, this week, and this month.
- **Session calendar** — Browse any month, click a day to see every work and break session with timestamps and durations.
- **Annual report** — Full-year breakdown with overtime balance, goal days met, monthly table, and a Print / Save as PDF button.
- **Configurable alerts** — Audio alerts fire when you're 30 minutes (configurable), 10 minutes, and 0 minutes from your daily goal.

---

## Getting Started

**Requirements:** Python 3.11+

```bash
# 1. Clone the repository
git clone https://github.com/erasmosoares/work-timer.git
cd work-timer

# 2. Install the single dependency
pip install flask

# 3. Start the server
python app.py
```

Open **http://localhost:5001** in your browser.

> Port 5000 is reserved by macOS AirPlay Receiver, so the app runs on **5001**.

The SQLite database (`worktime.db`) is created automatically on first run next to `app.py`.

---

## Using the App

### Dashboard layout

The dashboard is split into two columns:

| Left column | Right column |
|---|---|
| Settings + Timer + Goal banner | Progress summaries + Calendar |

### Timer controls

| Button | Action |
|---|---|
| **Start** | Begin a work session (`idle → working`) |
| **Pause** | Start a break (`working → break`) |
| **Resume** | End the break, continue working (`break → working`) |
| **Stop** | End the session entirely (`any → idle`) |

The timer display changes colour as you approach your daily goal:
- **Yellow** — within the configured alert window (default 30 min)
- **Red** — within 10 minutes
- **Green** — goal reached

### Settings

| Field | Description |
|---|---|
| Daily Hours | Your target work hours per day |
| Weekly Hours | Your target work hours per week |
| Alert (minutes before end) | How early the first audio alert fires |
| Hourly Rate ($) | Used to calculate earnings; leave at 0 to hide |

### Calendar

- Navigate months with the **‹** and **›** buttons.
- Days with recorded work are highlighted with an accent dot.
- **Click any day** to see a full session log (work and break entries, start/end times, duration, and earnings per session).
- Today is always pre-selected when you're on the current month.

### Annual Report

Click **Annual Report** in the header to open the current year's report in a new tab. The report includes:

- **Year at a Glance** — total worked, target hours, overtime balance, average daily hours, goal days met, best month, total earnings
- **Monthly Breakdown** — per-month table with working days, target vs worked, overtime (+/−), goal days, progress bar, and earnings

Use the **Print / Save as PDF** button (top right of the report page) to export. Navigate to other years with the **‹ year** / **year ›** buttons.

---

## Project Structure

```
work-timer/
├── app.py           # Flask routes
├── database.py      # SQLite helpers and all data logic
├── requirements.txt
├── static/
│   ├── app.js       # Frontend — timer, calendar, settings
│   └── style.css    # Dark theme UI
└── templates/
    ├── index.html   # Main dashboard
    └── report.html  # Annual report (print-friendly)
```

---

## Architecture Notes

- **No in-memory state** — timer state is derived entirely from the database. A row in `work_sessions` with `end_time IS NULL` is the active session.
- **State machine** — `idle → working → break → working → idle`. Each transition closes the current open row and opens a new one.
- **Time accumulation** — `get_day_seconds()` sums all `work`-type sessions for the day, using `now` as the end time for the active session.
- **Config** — stored as key/value rows in a `config` table. Valid keys: `daily_hours`, `weekly_hours`, `alert_minutes`, `hourly_rate`.

---

## License

MIT
