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


@app.route("/report/<int:year>")
def annual_report(year):
    data = db.get_annual_report(year)
    return render_template("report.html", **data)


if __name__ == "__main__":
    db.init_db()
    print("Work Timer running at http://localhost:5001")
    app.run(debug=True, port=5001)
