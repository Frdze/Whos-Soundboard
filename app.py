import requests
from flask import Flask, jsonify, request, send_file

from myinstants_api import download_mp3, search


app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


@app.get("/")
def index():
    return send_file("index.html")


@app.get("/simple")
def simple_index():
    return send_file("simple.html")


@app.get("/search")
def search_sounds():
    name = request.args.get("name", "").strip()
    if not name:
        return jsonify({"error": "Missing name query parameter"}), 400

    max_pages = request.args.get("max_pages") or request.args.get("maxPages")

    try:
        return jsonify(search(name, max_pages=max_pages))
    except requests.RequestException as exc:
        return jsonify({"error": "Failed to fetch search results", "details": str(exc)}), 502


@app.get("/api/search")
def api_search_sounds():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "No query provided"}), 400

    max_pages = request.args.get("max_pages") or request.args.get("maxPages")

    try:
        results = search(query, max_pages=max_pages)
        return jsonify(
            [
                {
                    "title": item.get("name") or "Unknown Sound",
                    "mp3_url": item.get("mp3_url", ""),
                }
                for item in results
                if item.get("mp3_url")
            ]
        )
    except requests.RequestException as exc:
        return jsonify({"error": "Failed to fetch search results", "details": str(exc)}), 502


@app.route("/download", methods=["GET", "POST"])
def download_sound():
    data = request.get_json(silent=True) or {}
    url = data.get("url") or request.args.get("url", "").strip()
    filename = data.get("filename") or request.args.get("filename")

    if not url:
        return jsonify({"error": "Missing url parameter"}), 400

    try:
        saved_path = download_mp3(url, filename)
        return jsonify({"saved_to": saved_path})
    except requests.RequestException as exc:
        return jsonify({"error": "Failed to download mp3", "details": str(exc)}), 502


if __name__ == "__main__":
    app.run(debug=False, use_reloader=False)
