"""Traductor local en->es (Argos Translate) con API compatible con LibreTranslate.

Uso:
  .venv\\Scripts\\python scripts\\translator.py --install   # descarga el modelo en->es (una vez)
  .venv\\Scripts\\python scripts\\translator.py             # arranca en http://127.0.0.1:5001

Todo se ejecuta en esta maquina: el texto de las fichas no sale a ningun servicio externo
(solo la descarga inicial del modelo).
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import argostranslate.package
import argostranslate.translate

SRC, DST = "en", "es"
PORT = 5001
lock = threading.Lock()  # el modelo no es seguro entre hilos


def install_model():
    argostranslate.package.update_package_index()
    pkgs = argostranslate.package.get_available_packages()
    pkg = next((p for p in pkgs if p.from_code == SRC and p.to_code == DST), None)
    if pkg is None:
        sys.exit("No se encontro el paquete en->es en el indice de Argos")
    argostranslate.package.install_from_path(pkg.download())
    print("Modelo en->es instalado")


def has_model():
    langs = {l.code: l for l in argostranslate.translate.get_installed_languages()}
    return SRC in langs and DST in langs and langs[SRC].get_translation(langs[DST]) is not None


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True, "model": has_model()})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/translate":
            return self._send(404, {"error": "not found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 200_000:
                return self._send(413, {"error": "payload too large"})
            data = json.loads(self.rfile.read(size) or b"{}")
            q = data.get("q", "")
            items = q if isinstance(q, list) else [q]
            with lock:
                out = [argostranslate.translate.translate(str(t), SRC, DST) for t in items]
            self._send(200, {"translatedText": out if isinstance(q, list) else out[0]})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    if "--install" in sys.argv:
        install_model()
        sys.exit(0)
    if not has_model():
        sys.exit("Falta el modelo en->es. Ejecuta primero: scripts\\translator.py --install")
    print(f"Traductor local en http://127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
