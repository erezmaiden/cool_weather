import json
import os
import ssl
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler
import socketserver

import pg8000


def require_env(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value

HOST = require_env("HOST")
PORT = int(require_env("PORT"))


def get_db_connection():
    conn = getattr(Handler, "_db_conn", None)
    if conn is None:
        conn = pg8000.connect(
            user=require_env("DB_USER"),
            password=require_env("DB_PASSWORD"),
            host=require_env("DB_HOST"),
            port=int(require_env("DB_PORT")),
            database=require_env("DB_NAME"),
        )
        conn.autocommit = True
        Handler._db_conn = conn
    return conn


def initialize_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS weather_history (
            id SERIAL PRIMARY KEY,
            city TEXT,
            latitude DOUBLE PRECISION NOT NULL,
            longitude DOUBLE PRECISION NOT NULL,
            temperature DOUBLE PRECISION,
            windspeed DOUBLE PRECISION,
            weathercode INTEGER,
            observation_time TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    cursor.close()


def load_file_config():
    path = os.environ.get('APP_CONFIG_PATH', 'config.json')
    if not os.path.exists(path):
        return {}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def parse_json_env(name, default):
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def get_app_config():
    config = load_file_config()
    config['weatherApiBase'] = os.environ.get('WEATHER_API_BASE', config.get('weatherApiBase'))
    config['weatherApiParams'] = os.environ.get('WEATHER_API_PARAMS', config.get('weatherApiParams'))
    config['ipLocationUrl'] = os.environ.get('IP_LOCATION_URL', config.get('ipLocationUrl'))
    config['cities'] = parse_json_env('WEATHER_CITIES', config.get('cities', {}))
    config['timezoneToCity'] = parse_json_env('TIMEZONE_CITY_MAP', config.get('timezoneToCity', {}))
    if 'HISTORY_LIMIT' in os.environ:
        config['historyLimit'] = int(os.environ['HISTORY_LIMIT'])
    else:
        config['historyLimit'] = int(config.get('historyLimit', 10))
    return config


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Serve files from ./static directory; map "/" -> "/static/index.html"
        parsed = urllib.parse.urlparse(path)
        rel_path = parsed.path
        if rel_path == "/":
            rel_path = "/static/index.html"
        elif rel_path.startswith('/static/'):
            rel_path = rel_path
        else:
            rel_path = "/static" + rel_path
        full_path = SimpleHTTPRequestHandler.translate_path(self, rel_path)
        return full_path

    def do_GET(self):
        route = urllib.parse.urlparse(self.path).path
        if route == '/api/history':
            self.handle_get_history()
            return
        if route == '/api/config':
            self.handle_get_config()
            return
        if route == '/ip-location':
            self.handle_ip_location()
            return
        super().do_GET()

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        if route == '/api/history':
            self.handle_post_history()
            return
        self.send_error(404, 'Not Found')

    def do_DELETE(self):
        route = urllib.parse.urlparse(self.path).path
        if route == '/api/history':
            self.handle_delete_history()
            return
        self.send_error(404, 'Not Found')

    def handle_get_history(self):
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT city, latitude, longitude, temperature, windspeed, weathercode, observation_time, created_at "
            "FROM weather_history ORDER BY created_at DESC LIMIT %s",
            [get_app_config()['historyLimit']],
        )
        rows = cursor.fetchall()
        cursor.close()
        history = [
            {
                'city': row[0],
                'latitude': float(row[1]),
                'longitude': float(row[2]),
                'temperature': float(row[3]) if row[3] is not None else None,
                'windspeed': float(row[4]) if row[4] is not None else None,
                'weathercode': int(row[5]) if row[5] is not None else None,
                'observation_time': row[6].isoformat() if row[6] is not None else None,
                'created_at': row[7].isoformat() if row[7] is not None else None,
            }
            for row in rows
        ]
        self.send_json({'history': history})

    def handle_post_history(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            payload = json.loads(body.decode('utf-8'))
        except Exception:
            self.send_error(400, 'Invalid JSON payload')
            return

        city = payload.get('city')
        latitude = payload.get('latitude')
        longitude = payload.get('longitude')
        temperature = payload.get('temperature')
        windspeed = payload.get('windspeed')
        weathercode = payload.get('weathercode')
        observation_time = payload.get('observation_time')

        if latitude is None or longitude is None:
            self.send_error(400, 'Latitude and longitude are required')
            return

        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO weather_history (city, latitude, longitude, temperature, windspeed, weathercode, observation_time) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                [city, latitude, longitude, temperature, windspeed, weathercode, observation_time],
            )
            cursor.close()
        except Exception as exc:
            self.send_error(500, f'Failed to save history: {exc}')
            return

        self.send_json({'ok': True})

    def handle_delete_history(self):
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute('DELETE FROM weather_history')
            cursor.close()
        except Exception as exc:
            self.send_error(500, f'Failed to clear history: {exc}')
            return

        self.send_json({'ok': True})

    def handle_get_config(self):
        self.send_json(get_app_config())

    def handle_ip_location(self):
        url = get_app_config()['ipLocationUrl']
        try:
            context = ssl.create_default_context()
            response = urllib.request.urlopen(url, timeout=10, context=context)
            data = response.read()
        except Exception:
            context = ssl._create_unverified_context()
            response = urllib.request.urlopen(url, timeout=10, context=context)
            data = response.read()

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, data, status=200):
        payload = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == '__main__':
    os.chdir(os.path.dirname(__file__) or '.')
    initialize_db()
    with socketserver.TCPServer((HOST, PORT), Handler) as httpd:
        print(f'Starting weather backend on http://{HOST}:{PORT}')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('Shutting down')
            httpd.shutdown()
