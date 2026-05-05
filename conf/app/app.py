"""
CV-3000 — Backend YunoHost
Rôle : servir l'interface web statique + stocker/exporter l'historique.
Le port série est lu DIRECTEMENT par le navigateur via Web Serial API.
Aucune dépendance pyserial côté serveur.
"""
import os
import csv
import json
import datetime

from flask import Flask, jsonify, request, send_file, render_template


DATA_FILE = os.environ.get(
    "CV3000_DATA_FILE",
    os.path.join(os.path.dirname(__file__), "cv3000_mesures.json"),
)


def _load():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(data):
    os.makedirs(os.path.dirname(os.path.abspath(DATA_FILE)), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def create_app():
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

    # ── API historique ───────────────────────────────────────
    @app.route("/api/history", methods=["GET"])
    def get_history():
        return jsonify({"history": _load()})

    @app.route("/api/history", methods=["POST"])
    def add_measurement():
        payload = request.get_json(force=True) or {}
        history = _load()
        history.append(payload)
        _save(history)
        return jsonify({"ok": True, "count": len(history)})

    @app.route("/api/history/<int:idx>", methods=["DELETE"])
    def delete_measurement(idx):
        history = _load()
        if 0 <= idx < len(history):
            history.pop(idx)
            _save(history)
            return jsonify({"ok": True})
        return jsonify({"ok": False, "msg": "Index hors limites"}), 404

    @app.route("/api/history", methods=["DELETE"])
    def clear_history():
        _save([])
        return jsonify({"ok": True})

    # ── Export CSV ───────────────────────────────────────────
    @app.route("/api/export_csv")
    def export_csv():
        history = _load()
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        fname = f"/tmp/cv3000_{stamp}.csv"
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
                    od.get("sph", ""),  od.get("cyl", ""),  od.get("ax", ""),
                    od.get("add", ""),  od.get("pd",  ""),
                    os_.get("sph", ""), os_.get("cyl", ""), os_.get("ax", ""),
                    os_.get("add", ""), os_.get("pd",  ""),
                    m.get("format", ""),
                ])
        return send_file(
            fname,
            as_attachment=True,
            download_name=f"cv3000_{stamp}.csv",
            mimetype="text/csv",
        )

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=6500, debug=True)
