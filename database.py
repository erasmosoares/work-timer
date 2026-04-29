import sqlite3
import calendar
from datetime import datetime, timezone, date
from pathlib import Path

DB_PATH = Path(__file__).parent / "worktime.db"

DEFAULT_CONFIG = {
    "daily_hours": "7",
    "weekly_hours": "35",
    "alert_minutes": "30",
    "hourly_rate": "0",
}


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS work_sessions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                date         TEXT NOT NULL,
                start_time   TEXT NOT NULL,
                end_time     TEXT,
                session_type TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        for key, value in DEFAULT_CONFIG.items():
            conn.execute(
                "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()


def get_config():
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM config").fetchall()
    return {r["key"]: r["value"] for r in rows}


def set_config(updates: dict):
    with get_conn() as conn:
        for key, value in updates.items():
            conn.execute(
                "INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)",
                (key, str(value)),
            )
        conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return date.today().isoformat()


def get_active_session():
    """Return the currently open session (end_time IS NULL), or None."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM work_sessions WHERE end_time IS NULL ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def start_session(session_type: str = "work") -> dict:
    now = _now_iso()
    today = _today()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO work_sessions (date, start_time, session_type) VALUES (?, ?, ?)",
            (today, now, session_type),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM work_sessions WHERE id = ?", (cur.lastrowid,)
        ).fetchone()
    return dict(row)


def close_active_session() -> dict | None:
    """Set end_time on the currently active session."""
    active = get_active_session()
    if not active:
        return None
    now = _now_iso()
    with get_conn() as conn:
        conn.execute(
            "UPDATE work_sessions SET end_time = ? WHERE id = ?",
            (now, active["id"]),
        )
        conn.commit()
    active["end_time"] = now
    return active


def get_current_state() -> str:
    """Derive timer state from the active session."""
    active = get_active_session()
    if not active:
        return "idle"
    return "working" if active["session_type"] == "work" else "break"


def _session_seconds(session: dict, now_dt: datetime) -> float:
    start = datetime.fromisoformat(session["start_time"])
    end = (
        datetime.fromisoformat(session["end_time"])
        if session["end_time"]
        else now_dt
    )
    return max(0.0, (end - start).total_seconds())


def get_day_seconds(target_date: str | None = None) -> float:
    target_date = target_date or _today()
    now_dt = datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_sessions WHERE date = ? AND session_type = 'work'",
            (target_date,),
        ).fetchall()
    return sum(_session_seconds(dict(r), now_dt) for r in rows)


def get_week_seconds() -> float:
    today = date.today()
    iso = today.isocalendar()
    year, week = iso.year, iso.week
    now_dt = datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_sessions WHERE session_type = 'work'"
        ).fetchall()
    total = 0.0
    for r in rows:
        d = date.fromisoformat(r["date"])
        di = d.isocalendar()
        if di.year == year and di.week == week:
            total += _session_seconds(dict(r), now_dt)
    return total


def get_month_seconds() -> float:
    today = date.today()
    year, month = today.year, today.month
    now_dt = datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_sessions WHERE date LIKE ? AND session_type = 'work'",
            (f"{year}-{month:02d}-%",),
        ).fetchall()
    return sum(_session_seconds(dict(r), now_dt) for r in rows)


def get_month_working_days() -> int:
    today = date.today()
    _, days_in_month = calendar.monthrange(today.year, today.month)
    return sum(
        1
        for d in range(1, days_in_month + 1)
        if date(today.year, today.month, d).weekday() < 5
    )


def get_calendar_month(year: int, month: int) -> dict:
    """Return {date_str: seconds} for each day in the given month that has work."""
    prefix = f"{year}-{month:02d}-%"
    now_dt = datetime.now(timezone.utc)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_sessions WHERE date LIKE ? AND session_type = 'work'",
            (prefix,),
        ).fetchall()
    result = {}
    for r in rows:
        r = dict(r)
        d = r["date"]
        result[d] = result.get(d, 0) + _session_seconds(r, now_dt)
    return result


def get_day_sessions(target_date: str) -> list:
    """Return all sessions for a given date ordered by start_time."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM work_sessions WHERE date = ? ORDER BY start_time ASC",
            (target_date,),
        ).fetchall()
    return [dict(r) for r in rows]


def _fmt_hm(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600}h {(s % 3600) // 60:02d}m"


def _fmt_overtime(seconds: float) -> str:
    sign = "+" if seconds >= 0 else "-"
    s = abs(int(seconds))
    return f"{sign}{s // 3600}h {(s % 3600) // 60:02d}m"


def get_annual_report(year: int) -> dict:
    now_dt = datetime.now(timezone.utc)
    today = date.today()
    config = get_config()
    daily_hours = float(config.get("daily_hours", 7))
    hourly_rate = float(config.get("hourly_rate", 0))

    with get_conn() as conn:
        all_rows = conn.execute(
            "SELECT * FROM work_sessions WHERE date LIKE ? AND session_type = 'work'",
            (f"{year}-%",),
        ).fetchall()

    by_date: dict = {}
    for r in all_rows:
        r = dict(r)
        d = r["date"]
        by_date[d] = by_date.get(d, 0.0) + _session_seconds(r, now_dt)

    months_data = []
    total_worked = 0.0
    total_target = 0.0
    total_goal_days = 0
    total_worked_days = 0
    best_month_name = None
    best_month_seconds = 0.0

    for m in range(1, 13):
        if year > today.year or (year == today.year and m > today.month):
            break

        _, days_in_month = calendar.monthrange(year, m)
        last_day = today.day if (year == today.year and m == today.month) else days_in_month

        working_days = sum(
            1 for d in range(1, last_day + 1)
            if date(year, m, d).weekday() < 5
        )
        target_seconds = working_days * daily_hours * 3600
        worked_seconds = sum(
            v for k, v in by_date.items()
            if k.startswith(f"{year}-{m:02d}-")
        )
        goal_days = sum(
            1 for d in range(1, last_day + 1)
            if date(year, m, d).weekday() < 5
            and by_date.get(f"{year}-{m:02d}-{d:02d}", 0) >= daily_hours * 3600
        )
        worked_days = sum(
            1 for d in range(1, last_day + 1)
            if by_date.get(f"{year}-{m:02d}-{d:02d}", 0) > 0
        )
        overtime_seconds = worked_seconds - target_seconds
        earnings = round((worked_seconds / 3600) * hourly_rate, 2) if hourly_rate > 0 else None
        pct = min(100.0, round(worked_seconds / target_seconds * 100, 1)) if target_seconds > 0 else 0.0

        if worked_seconds > best_month_seconds:
            best_month_seconds = worked_seconds
            best_month_name = calendar.month_name[m]

        months_data.append({
            "month_name": calendar.month_name[m],
            "working_days": working_days,
            "worked_days": worked_days,
            "goal_days": goal_days,
            "target_hm": _fmt_hm(target_seconds),
            "worked_hm": _fmt_hm(worked_seconds),
            "overtime_hm": _fmt_overtime(overtime_seconds),
            "overtime_positive": overtime_seconds >= 0,
            "earnings": f"{earnings:.2f}" if earnings is not None else None,
            "pct": pct,
        })

        total_worked += worked_seconds
        total_target += target_seconds
        total_goal_days += goal_days
        total_worked_days += worked_days

    total_overtime = total_worked - total_target
    total_earnings = round((total_worked / 3600) * hourly_rate, 2) if hourly_rate > 0 else None
    avg_daily = total_worked / total_worked_days if total_worked_days > 0 else 0.0

    return {
        "year": year,
        "prev_year": year - 1,
        "next_year": year + 1,
        "has_next": year < today.year,
        "daily_hours": daily_hours,
        "hourly_rate": hourly_rate,
        "has_earnings": hourly_rate > 0,
        "months": months_data,
        "total_worked_hm": _fmt_hm(total_worked),
        "total_target_hm": _fmt_hm(total_target),
        "total_overtime_hm": _fmt_overtime(total_overtime),
        "total_overtime_positive": total_overtime >= 0,
        "total_worked_days": total_worked_days,
        "total_goal_days": total_goal_days,
        "avg_daily_hm": _fmt_hm(avg_daily),
        "best_month": best_month_name if best_month_seconds > 0 else None,
        "total_earnings": f"{total_earnings:.2f}" if total_earnings is not None else None,
        "generated_on": today.strftime("%B %d, %Y"),
    }


def get_status() -> dict:
    active = get_active_session()
    state = get_current_state()
    day_seconds = get_day_seconds()
    result = {
        "state": state,
        "elapsed_seconds_today": day_seconds,
        "active_session_start": active["start_time"] if active else None,
        "active_session_type": active["session_type"] if active else None,
    }
    return result
