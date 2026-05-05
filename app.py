from flask import Flask, jsonify, render_template, request
import database as db

app = Flask(__name__)
db.init_db()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(db.get_config())


@app.route("/api/config", methods=["PUT"])
def update_config():
    data = request.get_json(force=True)
    allowed = {"daily_hours", "weekly_hours", "alert_minutes", "hourly_rate"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({"error": "No valid config keys"}), 400
    db.set_config(updates)
    return jsonify(db.get_config())


@app.route("/api/status", methods=["GET"])
def status():
    return jsonify(db.get_status())


@app.route("/api/sessions/start", methods=["POST"])
def session_start():
    state = db.get_current_state()
    if state != "idle":
        return jsonify({"error": f"Cannot start, current state is '{state}'"}), 409
    session = db.start_session("work")
    return jsonify({"session": session, "state": "working"})


@app.route("/api/sessions/pause", methods=["POST"])
def session_pause():
    state = db.get_current_state()
    if state != "working":
        return jsonify({"error": f"Cannot pause, current state is '{state}'"}), 409
    db.close_active_session()
    break_session = db.start_session("break")
    return jsonify({"session": break_session, "state": "break"})


@app.route("/api/sessions/resume", methods=["POST"])
def session_resume():
    state = db.get_current_state()
    if state != "break":
        return jsonify({"error": f"Cannot resume, current state is '{state}'"}), 409
    db.close_active_session()
    work_session = db.start_session("work")
    return jsonify({"session": work_session, "state": "working"})


@app.route("/api/sessions/stop", methods=["POST"])
def session_stop():
    state = db.get_current_state()
    if state == "idle":
        return jsonify({"error": "No active session"}), 409
    db.close_active_session()
    return jsonify({"state": "idle"})


@app.route("/api/progress/day", methods=["GET"])
def progress_day():
    seconds = db.get_day_seconds()
    return jsonify({"seconds": seconds})


@app.route("/api/progress/week", methods=["GET"])
def progress_week():
    seconds = db.get_week_seconds()
    return jsonify({"seconds": seconds})


@app.route("/api/progress/month", methods=["GET"])
def progress_month():
    seconds = db.get_month_seconds()
    working_days = db.get_month_working_days()
    return jsonify({"seconds": seconds, "working_days": working_days})


@app.route("/api/calendar/<int:year>/<int:month>", methods=["GET"])
def calendar_month(year, month):
    return jsonify(db.get_calendar_month(year, month))


@app.route("/api/sessions/log/<date>", methods=["GET"])
def sessions_log(date):
    sessions = db.get_day_sessions(date)
    return jsonify({"date": date, "sessions": sessions})


@app.route("/api/sessions/manual", methods=["POST"])
def add_manual_session():
    data = request.get_json(force=True)
    date_str = data.get("date")
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    session_type = data.get("session_type", "work")
    if not all([date_str, start_time, end_time]):
        return jsonify({"error": "Missing required fields"}), 400
    if session_type not in ("work", "break"):
        return jsonify({"error": "Invalid session_type"}), 400
    if start_time >= end_time:
        return jsonify({"error": "start_time must be before end_time"}), 400
    db.insert_session(date_str, start_time, end_time, session_type)
    return jsonify({"ok": True})


@app.route("/api/sessions/<int:session_id>", methods=["PUT"])
def update_session(session_id):
    session = db.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    if session["end_time"] is None:
        return jsonify({"error": "Cannot edit the active session"}), 409
    data = request.get_json(force=True)
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    session_type = data.get("session_type")
    if not all([start_time, end_time, session_type]):
        return jsonify({"error": "Missing required fields"}), 400
    if session_type not in ("work", "break"):
        return jsonify({"error": "Invalid session_type"}), 400
    if start_time >= end_time:
        return jsonify({"error": "start_time must be before end_time"}), 400
    db.update_session(session_id, start_time, end_time, session_type)
    return jsonify({"ok": True})


@app.route("/api/sessions/<int:session_id>", methods=["DELETE"])
def delete_session(session_id):
    session = db.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    if session["end_time"] is None:
        return jsonify({"error": "Cannot delete the active session"}), 409
    db.delete_session(session_id)
    return jsonify({"ok": True})


@app.route("/report/<int:year>")
def annual_report(year):
    data = db.get_annual_report(year)
    return render_template("report.html", **data)


if __name__ == "__main__":
    db.init_db()
    print("Work Timer running at http://localhost:5001")
    app.run(debug=True, port=5001)
