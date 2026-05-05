"""
CV-3000 — Backend YunoHost
Historique individuel par utilisateur via header Remote-User (SSO YunoHost).
"""
import os
import re
import csv
import json
import datetime

from flask import Flask, jsonify, request, send_file, render_template
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.wrappers import Response


DATA_DIR   = os.environ.get("CV3000_DATA_DIR",  "/var/lib/cv3000")
URL_PREFIX = os.environ.get("CV3000_URL_PREFIX", "").rstrip("/")


def _username():
    """Retourne le nom d'utilisateur YunoHost depuis le header SSO, ou 'anonymous'."""
    # YunoHost SSO transmet le nom via $remote_user NGINX → header X-Remote-User
    user = request.headers.get("X-Remote-User", "").strip()
    if not user:
        user = request.headers.get("Remote-User", "").strip()
    # Sécurité : n'autoriser que des caractères valides pour un nom de fichier
    if user and re.match(r'^[a-zA-Z0-9._-]+$', user):
        return user
    return "anonymous"


def _data_file(username):
    os.makedirs(DATA_DIR, exist_ok=True)
    return os.path.join(DATA_DIR, f"mesures_{username}.json")


def _load(username):
    try:
        with open(_data_file(username), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(username, data):
    with open(_data_file(username), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def create_flask_app():
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )
    app.config["SECRET_KEY"] = os.urandom(24).hex()

    # ── Page principale ──────────────────────────────────────
    @app.route("/")
    def index():
        return render_template("index.html")

    # ── Utilisateur courant ──────────────────────────────────
    @app.route("/api/me")
    def me():
        return jsonify({"user": _username()})

    # ── API historique ───────────────────────────────────────
    @app.route("/api/history", methods=["GET"])
    def get_history():
        return jsonify({"history": _load(_username()), "user": _username()})

    @app.route("/api/history", methods=["POST"])
    def add_measurement():
        payload = request.get_json(force=True) or {}
        user = _username()
        history = _load(user)
        history.append(payload)
        _save(user, history)
        return jsonify({"ok": True, "count": len(history)})

    @app.route("/api/history/<int:idx>", methods=["DELETE"])
    def delete_measurement(idx):
        user = _username()
        history = _load(user)
        if 0 <= idx < len(history):
            history.pop(idx)
            _save(user, history)
            return jsonify({"ok": True})
        return jsonify({"ok": False, "msg": "Index hors limites"}), 404

    @app.route("/api/history", methods=["DELETE"])
    def clear_history():
        _save(_username(), [])
        return jsonify({"ok": True})

    # ── Export CSV ───────────────────────────────────────────
    @app.route("/api/export_csv")
    def export_csv():
        user    = _username()
        history = _load(user)
        stamp   = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        fname   = f"/tmp/cv3000_{user}_{stamp}.csv"
        with open(fname, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow([
                "Date/Heure",
                "OD_Sph", "OD_Cyl", "OD_Ax", "OD_Add", "OD_PD",
                "OS_Sph", "OS_Cyl", "OS_Ax", "OS_Add", "OS_PD",
                "Format",
            ])
            for m in history:
                od  = m.get("OD") or {}
                os_ = m.get("OS") or {}
                w.writerow([
                    m.get("timestamp", ""),
                    od.get("sph",""),  od.get("cyl",""),  od.get("ax",""),
                    od.get("add",""),  od.get("pd", ""),
                    os_.get("sph",""), os_.get("cyl",""), os_.get("ax",""),
                    os_.get("add",""), os_.get("pd", ""),
                    m.get("format",""),
                ])
        return send_file(
            fname,
            as_attachment=True,
            download_name=f"cv3000_{user}_{stamp}.csv",
            mimetype="text/csv",
        )

    return app


def create_app():
    flask_app = create_flask_app()
    if URL_PREFIX:
        application = DispatcherMiddleware(
            Response("Not Found", status=404),
            {URL_PREFIX: flask_app}
        )
        return application
    return flask_app


if __name__ == "__main__":
    from werkzeug.serving import run_simple
    run_simple("127.0.0.1", 6500, create_app(), use_reloader=True)
