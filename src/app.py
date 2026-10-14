import os
import sys
import time
import secrets
import logging
import threading
import unicodedata
from datetime import datetime, timezone

from dotenv import load_dotenv
from flask import Flask, request, jsonify, render_template
from markupsafe import escape
from werkzeug.utils import secure_filename

# Load environment variables from .env file if present
load_dotenv()

try:  # fcntl only exists on Linux/macOS (the Docker container); the threading lock still protects on Windows
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None

app = Flask(__name__, template_folder='templates', static_folder='static')

# Overridable so a test instance can write to a scratch folder instead of the real media folder
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', '/uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Event branding configuration
COUPLE_NAME = os.environ.get('COUPLE_NAME', 'Our Wedding')
EVENT_TITLE = os.environ.get('EVENT_TITLE', f"{COUPLE_NAME}'s Wedding" if COUPLE_NAME != 'Our Wedding' else 'Wedding Moments')
EVENT_SUBTITLE = os.environ.get('EVENT_SUBTITLE', 'Share your moments from our special day')
APP_URL = os.environ.get('APP_URL', '').rstrip('/')

# All guest messages are appended to this single file, in the same folder as the media
MESSAGES_FILENAME = '_Guest Messages.txt'
MESSAGES_PATH = os.path.join(UPLOAD_FOLDER, MESSAGES_FILENAME)
MESSAGES_HEADER = (
    f"Guest messages — {EVENT_TITLE}\n"
    "Every message is added to the end of this file. Times are recorded by the server.\n\n"
)

# Activity log file in the upload directory for easy review alongside guest messages
ACTIVITY_LOG_FILENAME = '_activity.log'
ACTIVITY_LOG_PATH = os.path.join(UPLOAD_FOLDER, ACTIVITY_LOG_FILENAME)

MAX_NAME_LEN = 60
MAX_MESSAGE_LEN = 1000
MAX_MESSAGE_REQUEST_BYTES = 16 * 1024

# Timezone needs tzdata package on Alpine; fall back to UTC (offset still shown) if missing/invalid
TIMEZONE_NAME = os.environ.get('TZ', 'UTC')
try:
    from zoneinfo import ZoneInfo
    LOCAL_TZ = ZoneInfo(TIMEZONE_NAME)
except Exception:  # pragma: no cover
    LOCAL_TZ = timezone.utc

# Serialises writes to the messages file between request threads (flask runs threaded=True)
_messages_lock = threading.Lock()

# --- Logging Setup ---
logger = logging.getLogger('wedding_drop')
logger.setLevel(logging.INFO)
# Avoid duplicate handlers if reloaded
if not logger.handlers:
    formatter = logging.Formatter(
        fmt='[%(asctime)s] [%(levelname)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    # 1. Console Handler (captured by `docker logs wedding-drop`)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # 2. File Handler (persisted to ACTIVITY_LOG_PATH)
    try:
        file_handler = logging.FileHandler(ACTIVITY_LOG_PATH, encoding='utf-8')
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    except Exception as log_err:
        print(f"Warning: Could not initialize file handler at {ACTIVITY_LOG_PATH}: {log_err}", file=sys.stderr)

logger.info(f"Server initialized. Media directory: '{UPLOAD_FOLDER}', Timezone: '{LOCAL_TZ}'")


def get_client_ip():
    """Extract real client IP behind reverse proxies (e.g. Nginx Proxy Manager)."""
    if request.headers.get('X-Forwarded-For'):
        # First IP in comma-separated list is client IP
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    if request.headers.get('X-Real-IP'):
        return request.headers.get('X-Real-IP').strip()
    return request.remote_addr or 'unknown'


def get_user_agent():
    """Extract user agent for troubleshooting mobile/browser specific issues."""
    return request.headers.get('User-Agent', 'unknown')


def clean_text(value, multiline):
    """Normalise user text: NFC, unified newlines, no control characters, trimmed."""
    text = unicodedata.normalize('NFC', str(value or ''))
    text = text.replace('\r\n', '\n').replace('\r', '\n').replace('\t', ' ')
    text = ''.join(
        ch for ch in text
        if (ch == '\n' and multiline) or unicodedata.category(ch) != 'Cc'
    )
    if multiline:
        lines = [line.rstrip() for line in text.split('\n')]
        # Collapse runs of more than one blank line
        collapsed = []
        for line in lines:
            if line == '' and collapsed and collapsed[-1] == '':
                continue
            collapsed.append(line)
        text = '\n'.join(collapsed)
    else:
        text = ' '.join(text.split())
    return text.strip()


def filename_prefix(guest_name):
    """ASCII-safe prefix from the guest's name, e.g. 'Aunt Mary' -> 'Aunt_Mary'."""
    return secure_filename(guest_name)[:40].strip('._')


def build_media_name(original_name, prefix):
    """Unique filename: [prefix_]originalname_YYYYMMDD-HHMMSS_<random>.ext"""
    safe = secure_filename(original_name) or 'upload'
    name, ext = os.path.splitext(safe)
    stamp = datetime.now(LOCAL_TZ).strftime('%Y%m%d-%H%M%S')
    parts = [prefix, name[:80] or 'upload', stamp, secrets.token_hex(4)]
    return '_'.join(p for p in parts if p) + ext


def format_timestamp(dt):
    hour12 = dt.hour % 12 or 12
    ampm = 'am' if dt.hour < 12 else 'pm'
    return (f"{dt:%A} {dt.day} {dt:%b %Y}, {hour12}:{dt:%M:%S} {ampm} {dt.tzname()}"
            f"   [{dt.isoformat(timespec='seconds')}]")


@app.route('/', methods=['GET'])
def index():
    # Safely format couple name HTML, styling ampersands in italic if present
    safe_name = str(escape(COUPLE_NAME))
    if ' & ' in safe_name:
        couple_name_html = safe_name.replace(' & ', ' <span>&amp;</span> ')
    elif '&amp;' in safe_name:
        couple_name_html = safe_name.replace('&amp;', '<span>&amp;</span>')
    else:
        couple_name_html = safe_name

    return render_template(
        'index.html',
        couple_name=COUPLE_NAME,
        couple_name_html=couple_name_html,
        event_title=EVENT_TITLE,
        event_subtitle=EVENT_SUBTITLE,
        app_url=APP_URL
    )


@app.route('/upload', methods=['POST'])
def upload_files():
    req_start = time.time()
    ip = get_client_ip()
    ua = get_user_agent()
    content_len = request.content_length or 0
    content_len_str = f"{content_len / (1024*1024):.1f} MB" if content_len >= 1024*1024 else f"{content_len / 1024:.1f} KB"

    if 'files' not in request.files:
        logger.warning(f"[UPLOAD REJECTED] No 'files' part in request from IP {ip} [UA: {ua}]")
        return jsonify({'error': 'No files part'}), 400

    files = request.files.getlist('files')
    raw_name = request.form.get('guest_name', '')
    cleaned_name = clean_text(raw_name, multiline=False)[:MAX_NAME_LEN]
    prefix = filename_prefix(cleaned_name)
    guest_label = f"Guest '{cleaned_name}'" if cleaned_name else "Anonymous guest"

    logger.info(
        f"[UPLOAD START] {guest_label} from IP {ip} initiated upload of {len(files)} file(s) "
        f"({content_len_str}) [UA: {ua}]"
    )

    saved = []
    failed = []

    for file in files:
        if not file.filename:
            logger.warning(f"[UPLOAD SKIPPED] Empty filename received from IP {ip} ({guest_label})")
            continue

        file_start = time.time()

        # Measure file size
        try:
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            size_str = f"{file_size / (1024*1024):.2f} MB" if file_size >= 1024*1024 else f"{file_size / 1024:.1f} KB"
        except Exception:
            size_str = "unknown size"

        allocated = False
        # Exclusive create ("xb") guarantees an existing file is never overwritten,
        # even when several guests upload identically named files at the same moment.
        for attempt in range(5):
            unique_name = build_media_name(file.filename, prefix)
            if unique_name in (MESSAGES_FILENAME, ACTIVITY_LOG_FILENAME):
                continue
            path = os.path.join(UPLOAD_FOLDER, unique_name)
            try:
                handle = open(path, 'xb')
            except FileExistsError:
                logger.debug(f"[UPLOAD RETRY] Filename clash on '{unique_name}', re-generating...")
                continue
            except Exception as e:
                logger.error(
                    f"[UPLOAD FAILED] Could not create file handle '{path}' for '{file.filename}' "
                    f"from IP {ip} ({guest_label}): {e}",
                    exc_info=True
                )
                failed.append({'filename': file.filename, 'error': str(e)})
                break

            try:
                with handle:
                    file.save(handle)
                allocated = True
                duration = time.time() - file_start
                logger.info(
                    f"[UPLOAD SUCCESS] Saved '{file.filename}' ({size_str}) -> '{unique_name}' "
                    f"for {guest_label} from IP {ip} in {duration:.2f}s"
                )
                saved.append(unique_name)
                break
            except Exception as e:
                logger.error(
                    f"[UPLOAD FAILED] Exception saving stream for '{file.filename}' -> '{unique_name}' "
                    f"from IP {ip} ({guest_label}): {e}",
                    exc_info=True
                )
                try:
                    os.remove(path)
                except OSError:
                    pass
                failed.append({'filename': file.filename, 'error': str(e)})
                break

        if not allocated and file.filename not in [f['filename'] for f in failed]:
            err_msg = 'Could not allocate a unique filename after 5 attempts'
            logger.error(f"[UPLOAD FAILED] {err_msg} for '{file.filename}' from IP {ip}")
            failed.append({'filename': file.filename, 'error': err_msg})

    total_duration = time.time() - req_start

    if failed and not saved:
        logger.error(
            f"[UPLOAD COMPLETE: ALL FAILED] {len(failed)} file(s) failed in {total_duration:.2f}s "
            f"from IP {ip} ({guest_label}): {[f['filename'] for f in failed]}"
        )
        return jsonify({'error': 'Failed to save files', 'details': failed}), 500

    if failed and saved:
        logger.warning(
            f"[UPLOAD COMPLETE: PARTIAL] {len(saved)} saved, {len(failed)} failed in {total_duration:.2f}s "
            f"from IP {ip} ({guest_label})"
        )
        return jsonify({
            'message': f'Uploaded {len(saved)} file(s), {len(failed)} failed.',
            'saved': saved,
            'failed': failed,
            'count': len(saved)
        }), 207

    if not saved:
        logger.warning(f"[UPLOAD REJECTED] No valid files uploaded from IP {ip} ({guest_label})")
        return jsonify({'error': 'No valid files uploaded'}), 400

    logger.info(
        f"[UPLOAD COMPLETE: SUCCESS] All {len(saved)} file(s) saved in {total_duration:.2f}s "
        f"for {guest_label} from IP {ip}"
    )
    return jsonify({'message': f'Successfully uploaded {len(saved)} file(s).', 'count': len(saved)}), 200


@app.route('/message', methods=['POST'])
def save_message():
    ip = get_client_ip()
    ua = get_user_agent()
    content_len = request.content_length or 0

    if content_len > MAX_MESSAGE_REQUEST_BYTES:
        logger.warning(f"[MESSAGE REJECTED] Payload too large ({content_len} bytes) from IP {ip} [UA: {ua}]")
        return jsonify({'error': 'Message too large'}), 413

    data = request.get_json(silent=True) or {}
    name = clean_text(data.get('name', ''), multiline=False)[:MAX_NAME_LEN]
    message = clean_text(data.get('message', ''), multiline=True)
    guest_label = f"Guest '{name}'" if name else "Anonymous guest"

    if not message:
        logger.warning(f"[MESSAGE REJECTED] Empty message submitted from IP {ip} ({guest_label})")
        return jsonify({'error': 'Message is empty'}), 400
    if len(message) > MAX_MESSAGE_LEN:
        logger.warning(
            f"[MESSAGE REJECTED] Message length ({len(message)}) exceeds limit {MAX_MESSAGE_LEN} "
            f"from IP {ip} ({guest_label})"
        )
        return jsonify({'error': f'Message is longer than {MAX_MESSAGE_LEN} characters'}), 400

    try:
        file_count = max(0, min(int(data.get('file_count', 0)), 100000))
    except (TypeError, ValueError):
        file_count = 0

    now = datetime.now(LOCAL_TZ)
    sent_with = f"Sent with {file_count} photo{'s' if file_count != 1 else ''}/video{'s' if file_count != 1 else ''}" \
        if file_count else "Message only"
    entry = (
        f"{'─' * 56}\n"
        f"{format_timestamp(now)}\n"
        f"From: {name or '(no name given)'}   ·   {sent_with}\n"
        f"\n{message}\n\n"
    )

    try:
        with _messages_lock:
            # Append mode only: existing messages can never be truncated or overwritten
            with open(MESSAGES_PATH, 'a', encoding='utf-8', newline='\n') as f:
                if fcntl:
                    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    if os.fstat(f.fileno()).st_size == 0:
                        f.write(MESSAGES_HEADER)
                    f.write(entry)  # single write per entry, so entries never interleave
                    f.flush()
                    os.fsync(f.fileno())
                finally:
                    if fcntl:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)

        # Truncate one-line preview for log
        preview = message.replace('\n', ' ')
        if len(preview) > 80:
            preview = preview[:77] + '...'
        logger.info(
            f"[MESSAGE SAVED] From {guest_label} (IP {ip}) [{sent_with}, {len(message)} chars]: \"{preview}\""
        )
    except Exception as e:
        logger.error(f"[MESSAGE FAILED] Error saving message from {guest_label} (IP {ip}): {e}", exc_info=True)
        return jsonify({'error': 'Could not save message'}), 500

    return jsonify({'message': 'Message saved'}), 200


@app.errorhandler(413)
def handle_payload_too_large(e):
    ip = get_client_ip()
    ua = get_user_agent()
    logger.warning(f"[PAYLOAD TOO LARGE (413)] From IP {ip} [UA: {ua}]")
    return jsonify({'error': 'Payload or file too large'}), 413


@app.errorhandler(Exception)
def handle_unexpected_error(e):
    ip = get_client_ip()
    ua = get_user_agent()
    logger.error(f"[UNHANDLED SERVER ERROR] On {request.method} {request.path} from IP {ip} [UA: {ua}]: {e}", exc_info=True)
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000, threaded=True)
