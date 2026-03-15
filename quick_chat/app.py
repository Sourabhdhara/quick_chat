"""
Messaging App - Flask Backend
A real-time messaging application with user authentication,
private messaging, and group chat support.
"""

import os
import json
import uuid
import hashlib
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from flask import (
    Flask, render_template, request, redirect,
    url_for, session, jsonify, flash, send_from_directory
)
from werkzeug.utils import secure_filename

app = Flask(__name__)
# Persistent secret key — survives server restarts so sessions stay valid
_secret_key_file = os.path.join(os.path.dirname(__file__), "data", ".secret_key")
if os.path.exists(_secret_key_file):
    with open(_secret_key_file, "r") as f:
        app.secret_key = f.read().strip()
else:
    app.secret_key = os.urandom(32).hex()
    os.makedirs(os.path.dirname(_secret_key_file), exist_ok=True)
    with open(_secret_key_file, "w") as f:
        f.write(app.secret_key)

app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB max upload
app.config['PERMANENT_SESSION_LIFETIME'] = 60 * 60 * 24 * 30  # 30 days
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# --- Data directory ---
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
MESSAGES_FILE = os.path.join(DATA_DIR, "messages.json")
CONVERSATIONS_FILE = os.path.join(DATA_DIR, "conversations.json")
CALLS_FILE = os.path.join(DATA_DIR, "calls.json")
STORIES_FILE = os.path.join(DATA_DIR, "stories.json")
RESET_OTPS_FILE = os.path.join(DATA_DIR, "reset_otps.json")
EMAIL_OTPS_FILE = os.path.join(DATA_DIR, "email_otps.json")

ALLOWED_EXTENSIONS = {
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',  # images
    'mp4', 'webm', 'mov', 'avi',                   # video
    'mp3', 'wav', 'ogg', 'webm', 'm4a',            # audio
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',  # docs
    'txt', 'csv', 'zip', 'rar', '7z', 'tar', 'gz',  # misc
}


# ========================
#  JSON Storage Helpers
# ========================

def ensure_data_files():
    """Create data directory, uploads dir, and all required JSON files.

    Runs every time the server starts.  For each file it checks:
      1. Does it exist?
      2. Is it valid JSON?
      3. Is it the expected type (dict or list)?
    If any check fails the file is (re-)created with a safe default.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(UPLOADS_DIR, exist_ok=True)

    required_files = [
        (USERS_FILE,         dict),   # {}
        (MESSAGES_FILE,      list),   # []
        (CONVERSATIONS_FILE, dict),   # {}
        (CALLS_FILE,         dict),   # {}
        (STORIES_FILE,       list),   # []
        (RESET_OTPS_FILE,    dict),   # {}
        (EMAIL_OTPS_FILE,    dict),   # {}
    ]

    for path, expected_type in required_files:
        needs_reset = False

        if not os.path.exists(path):
            needs_reset = True
        else:
            # File exists — make sure it contains valid JSON of the right type
            try:
                with open(path, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                if not content:
                    # File is empty / blank
                    needs_reset = True
                else:
                    data = json.loads(content)
                    if not isinstance(data, expected_type):
                        needs_reset = True
            except (json.JSONDecodeError, ValueError, OSError):
                needs_reset = True

        if needs_reset:
            default = expected_type()          # {} for dict, [] for list
            with open(path, "w", encoding="utf-8") as f:
                json.dump(default, f, indent=2)
            print(f"  ✔  Recreated {os.path.basename(path)}")


def get_file_type(filename):
    """Determine the file category from extension."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext in ('png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'):
        return 'image'
    if ext in ('mp4', 'webm', 'mov', 'avi'):
        return 'video'
    if ext in ('mp3', 'wav', 'ogg', 'webm', 'm4a'):
        return 'audio'
    return 'file'


def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                # Return appropriate default for empty files
                return {} if path in (USERS_FILE, CONVERSATIONS_FILE, CALLS_FILE) else []
            return json.loads(content)
    except (json.JSONDecodeError, OSError):
        return {} if path in (USERS_FILE, CONVERSATIONS_FILE, CALLS_FILE) else []


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


# password reset helpers -------------------------------------------------

def _generate_otp(length: int = 6) -> str:
    """Generate a numeric one-time password (OTP)."""
    return f"{secrets.randbelow(10 ** length):0{length}d}"


def _read_otps() -> dict:
    data = read_json(RESET_OTPS_FILE)
    # Remove expired entries while reading
    now = datetime.utcnow()
    expired = [k for k, v in data.items() if v.get("expires_at") and _parse_iso(v["expires_at"]) < now]
    for k in expired:
        data.pop(k, None)
    return data


def _write_otps(data: dict):
    write_json(RESET_OTPS_FILE, data)


def _send_email(to_email: str, subject: str, body: str) -> bool:
    """Send email. Returns True if it appears to have been sent."""
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "465"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASS")
    from_addr = os.environ.get("FROM_EMAIL", smtp_user)

    if not smtp_user or not smtp_pass or not from_addr:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(body)

    try:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10) as smtp:
            smtp.login(smtp_user, smtp_pass)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        # Log the failure so the developer can diagnose SMTP issues.
        print(f"[email] send failed: {exc}")
        return False


# email verification helpers -------------------------------------------

def _read_email_otps() -> dict:
    data = read_json(EMAIL_OTPS_FILE)
    # Remove expired entries while reading
    now = datetime.utcnow()
    expired = [k for k, v in data.items() if v.get("expires_at") and _parse_iso(v["expires_at"]) < now]
    for k in expired:
        data.pop(k, None)
    return data


def _write_email_otps(data: dict):
    write_json(EMAIL_OTPS_FILE, data)


# time helpers -----------------------------------------------------------

def _parse_iso(s: str) -> datetime:
    """Parse an ISO string that may or may not include a timezone.

    The JSON stored timestamps are generated with :func:`now_iso`, which
    appends a ``Z`` for UTC.  Older records might lack the ``Z`` though, so we
    conservatively treat a bare ``YYYY-mm-ddTHH:MM:SS`` string as UTC rather
    than local time to avoid the five‑hour‑ago bug described by users.
    ``datetime.fromisoformat`` understands offsets like ``+00:00`` but not
    literal ``Z``, so we convert it first.

    The rest of the application uses naive UTC datetimes (via
    ``datetime.utcnow()``), so we return a naive UTC datetime to avoid
    timezone-aware vs naive comparisons.
    """
    if not s:
        raise ValueError("empty timestamp")
    if s.endswith("Z"):
        # convert UTC designator to an offset, which fromisoformat accepts
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def now_iso() -> str:
    """Return current time in UTC with a trailing ``Z`` (ISO 8601).

    Using UTC everywhere eliminates timezone mismatches between server and
    clients.  The trailing ``Z`` ensures browsers parse the value correctly as
    UTC rather than guessing local time, which was the root of the “5 hours
    ago” issue.
    """
    return datetime.utcnow().isoformat() + "Z"


def is_user_online(user):
    """A user is online if their last_seen is recent (30 seconds).

    The previous threshold of two seconds was far too aggressive; network
    jitter or a briefly hidden tab would almost always mark someone offline.
    Thirty seconds gives a reasonable balance between accuracy and stability.
    """
    last_seen = user.get("last_seen", "")
    if not last_seen:
        return False
    try:
        delta = (datetime.utcnow() - _parse_iso(last_seen)).total_seconds()
        return delta < 30
    except (ValueError, TypeError):
        return False


# ========================
#  Auth decorator
# ========================

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated


# ========================
#  Page Routes
# ========================

@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("chat"))
    return redirect(url_for("login"))


@app.route("/sw.js")
def service_worker():
    """Serve service worker from root scope."""
    response = send_from_directory(
        os.path.join(app.root_path, "static"), "sw.js"
    )
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        password = request.form.get("password", "")

        uid, user = _find_user_by_identifier(identifier)
        if user and user.get("password") == hash_password(password):
            session.permanent = True  # Keep session alive across browser closes
            session["user_id"] = uid
            session["username"] = user.get("username")
            # Update online status
            users = read_json(USERS_FILE)
            users[uid]["online"] = True
            users[uid]["last_seen"] = now_iso()
            write_json(USERS_FILE, users)
            return redirect(url_for("chat"))

        flash("Invalid username/email or password.", "error")
    return render_template("login.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")

        if not username or not password:
            flash("Username and password are required.", "error")
            return render_template("register.html")

        if email and ("@" not in email or "." not in email):
            flash("Please enter a valid email address.", "error")
            return render_template("register.html")

        if len(username) < 3:
            flash("Username must be at least 3 characters.", "error")
            return render_template("register.html")

        if len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
            return render_template("register.html")

        if password != confirm:
            flash("Passwords do not match.", "error")
            return render_template("register.html")

        users = read_json(USERS_FILE)

        # Check duplicate username
        for u in users.values():
            if u["username"].lower() == username.lower():
                flash("Username already taken.", "error")
                return render_template("register.html")

        # Check duplicate email (only if provided)
        if email:
            for u in users.values():
                if u.get("email", "").lower() == email.lower():
                    flash("An account with that email already exists.", "error")
                    return render_template("register.html")

        uid = str(uuid.uuid4())
        users[uid] = {
            "username": username,
            "email": email,
            "email_verified": False,
            "password": hash_password(password),
            "created_at": now_iso(),
            "avatar_color": f"#{hash_password(username)[:6]}",
            "online": False,
            "last_seen": now_iso(),
            "bio": "",
        }
        write_json(USERS_FILE, users)

        # If email was provided, send a verification OTP
        if email:
            otp = _generate_otp(6)
            expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
            tokens = _read_email_otps()
            tokens[uid] = {"email": email, "otp": otp, "expires_at": expires_at}
            _write_email_otps(tokens)

            # Save state so user can verify immediately
            session["verify_user_id"] = uid
            session["verify_email"] = email

            email_sent = _send_email(
                email,
                "QuickChat email verification code",
                f"Your QuickChat verification code is: {otp}\n\nThis code expires in 15 minutes."
            )

            if email_sent:
                flash("Verification code sent to your email. Please verify it to enable email login.", "info")
            else:
                flash("Account created. Verification code: " + otp, "info")

            return redirect(url_for("verify_email"))

        flash("Account created! Please log in.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


def _find_user_by_identifier(identifier: str):
    """Lookup a user by username or verified email (case-insensitive)."""
    users = read_json(USERS_FILE)
    identifier = (identifier or "").strip().lower()
    for uid, u in users.items():
        if u.get("username", "").lower() == identifier:
            return uid, u
        if u.get("email", "").lower() == identifier and u.get("email_verified"):
            return uid, u
    return None, None


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if request.method == "POST":
        identifier = request.form.get("identifier", "").strip()
        uid, user = _find_user_by_identifier(identifier)

        # Always show the same message to avoid revealing whether the user exists.
        flash("If an account exists for that username, an OTP has been sent to the registered email.", "info")

        if not uid or not user:
            return redirect(url_for("forgot_password"))

        otp = _generate_otp(6)
        expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()

        tokens = _read_otps()
        tokens[uid] = {"otp": otp, "expires_at": expires_at}
        _write_otps(tokens)

        # Keep the “reset session” so the next page doesn’t need the identifier again.
        session["reset_user_id"] = uid
        session["reset_identifier"] = identifier

        # Try to send OTP by email; in development fallback to showing the OTP.
        email_sent = False
        if user.get("email"):
            email_sent = _send_email(
                user["email"],
                "QuickChat password reset code",
                f"Your QuickChat password reset code is: {otp}\n\nThis code expires in 15 minutes."
            )

        if not email_sent:
            flash(f"(Demo) Your OTP is: {otp}", "info")

        return redirect(url_for("reset_password"))

    return render_template("forgot_password.html")


@app.route("/verify-email", methods=["GET", "POST"])
def verify_email():
    uid = session.get("verify_user_id")
    email = session.get("verify_email")

    if not uid or not email:
        return redirect(url_for("login"))

    if request.method == "POST":
        action = request.form.get("action")
        if action == "resend":
            otp = _generate_otp(6)
            expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()
            tokens = _read_email_otps()
            tokens[uid] = {"email": email, "otp": otp, "expires_at": expires_at}
            _write_email_otps(tokens)

            email_sent = _send_email(
                email,
                "QuickChat email verification code",
                f"Your QuickChat verification code is: {otp}\n\nThis code expires in 15 minutes."
            )
            if email_sent:
                flash("Verification code resent to your email.", "info")
            else:
                flash("Verification code: " + otp, "info")

            return redirect(url_for("verify_email"))

        otp = request.form.get("otp", "").strip()
        tokens = _read_email_otps()
        token = tokens.get(uid)
        if not token or token.get("otp") != otp:
            flash("Invalid verification code.", "error")
            return redirect(url_for("verify_email"))

        if _parse_iso(token.get("expires_at", "")) < datetime.utcnow():
            tokens.pop(uid, None)
            _write_email_otps(tokens)
            flash("Verification code expired. Please resend.", "error")
            return redirect(url_for("verify_email"))

        users = read_json(USERS_FILE)
        users[uid]["email_verified"] = True
        write_json(USERS_FILE, users)

        tokens.pop(uid, None)
        _write_email_otps(tokens)

        session.pop("verify_user_id", None)
        session.pop("verify_email", None)

        flash("Email verified! You can now sign in.", "success")
        return redirect(url_for("login"))

    return render_template("verify_email.html", email=email)


@app.route("/reset-password", methods=["GET", "POST"])
def reset_password():
    # If the user just requested a reset, we keep their identifier in session
    reset_uid = session.get("reset_user_id")
    reset_identifier = session.get("reset_identifier")

    if request.method == "POST":
        otp = request.form.get("otp", "").strip()
        password = request.form.get("password", "")
        confirm = request.form.get("confirm_password", "")

        if not password or password != confirm:
            flash("Passwords must match and cannot be empty.", "error")
            return redirect(url_for("reset_password"))

        # If we have the reset session, use it; otherwise fall back to identifier input.
        if reset_uid:
            uid = reset_uid
            user = _find_user_by_identifier(reset_identifier)[1] if reset_identifier else None
        else:
            identifier = request.form.get("identifier", "").strip()
            uid, user = _find_user_by_identifier(identifier)

        if not uid or not user:
            flash("Invalid email/username or OTP.", "error")
            return redirect(url_for("reset_password"))

        tokens = _read_otps()
        token = tokens.get(uid)
        if not token or token.get("otp") != otp:
            flash("Invalid username or OTP.", "error")
            return redirect(url_for("reset_password"))

        if _parse_iso(token.get("expires_at", "")) < datetime.utcnow():
            tokens.pop(uid, None)
            _write_otps(tokens)
            flash("OTP expired. Please request a new one.", "error")
            return redirect(url_for("forgot_password"))

        users = read_json(USERS_FILE)
        users[uid]["password"] = hash_password(password)
        write_json(USERS_FILE, users)

        tokens.pop(uid, None)
        _write_otps(tokens)

        # Clear the reset session so we don't reuse it later
        session.pop("reset_user_id", None)
        session.pop("reset_identifier", None)

        flash("Your password has been reset. Please log in.", "success")
        return redirect(url_for("login"))

    return render_template("reset_password.html", identifier=reset_identifier)


@app.route("/logout")
@login_required
def logout():
    uid = session.get("user_id")
    users = read_json(USERS_FILE)
    if uid in users:
        users[uid]["online"] = False
        # Do NOT overwrite last_seen with a fake date; keep the real last activity timestamp
        write_json(USERS_FILE, users)
    session.clear()
    return redirect(url_for("login"))


@app.route("/api/offline", methods=["POST"])
@login_required
def api_go_offline():
    """Mark user as offline immediately (called on tab close)."""
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    if uid in users:
        users[uid]["online"] = False
        # Do NOT overwrite last_seen with a fake date; keep the real last activity timestamp
        write_json(USERS_FILE, users)
    return jsonify({"ok": True})


@app.route("/chat")
@login_required
def chat():
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    user = users.get(uid, {})
    return render_template(
        "chat.html",
        user_id=uid,
        username=session["username"],
        avatar_color=user.get("avatar_color", "#6c63ff"),
        profile_pic=user.get("profile_pic", ""),
    )


# ========================
#  API Routes
# ========================

@app.route("/api/users")
@login_required
def api_users():
    """Return list of all users (excluding current user's password)."""
    users = read_json(USERS_FILE)
    result = []
    for uid, u in users.items():
        result.append({
            "id": uid,
            "username": u["username"],
            "avatar_color": u.get("avatar_color", "#6c63ff"),
            "profile_pic": u.get("profile_pic", ""),
            "online": is_user_online(u),
            "last_seen": u.get("last_seen", ""),
            "bio": u.get("bio", ""),
            "is_me": uid == session["user_id"],
        })
    return jsonify(result)


@app.route("/api/conversations")
@login_required
def api_conversations():
    """Return conversations the current user is part of."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)
    users = read_json(USERS_FILE)
    messages = read_json(MESSAGES_FILE)

    result = []
    for cid, convo in convos.items():
        if uid not in convo["members"]:
            continue

        # Find the last message in this conversation
        convo_msgs = [m for m in messages if m["conversation_id"] == cid]
        last_msg = convo_msgs[-1] if convo_msgs else None

        # For direct chats, show the other person's name
        display_name = convo.get("name", "")
        other_avatar_color = "#6c63ff"
        other_profile_pic = ""
        if convo["type"] == "direct":
            other_ids = [m for m in convo["members"] if m != uid]
            if other_ids and other_ids[0] in users:
                display_name = users[other_ids[0]]["username"]
                other_avatar_color = users[other_ids[0]].get("avatar_color", "#6c63ff")
                other_profile_pic = users[other_ids[0]].get("profile_pic", "")
        elif convo["type"] == "group":
            other_avatar_color = convo.get("color", "#6c63ff")

        # Skip conversations hidden for this user
        if uid in convo.get("hidden_for", []):
            continue

        result.append({
            "id": cid,
            "name": display_name,
            "type": convo["type"],
            "members": convo["members"],
            "admins": convo.get("admins", [convo.get("created_by", "")]),
            "created_by": convo.get("created_by", ""),
            "avatar_color": other_avatar_color,
            "profile_pic": other_profile_pic,
            "group_pic": convo.get("group_pic", ""),
            "description": convo.get("description", ""),
            "last_message": {
                "text": (last_msg.get("text", "") if last_msg.get("type", "text") == "text" else
                         ("📎 " + last_msg.get("text", "File") if last_msg.get("type") == "file" else
                          ("🎤 Voice message" if last_msg.get("type") == "voice" else
                           ("📍 Location" if last_msg.get("type") == "location" else
                            ("📞 " + last_msg.get("text", "Call") if last_msg.get("type") == "call" else last_msg.get("text", "")))))),
                "sender": users.get(last_msg["sender_id"], {}).get("username", "Unknown"),
                "timestamp": last_msg["timestamp"],
                "type": last_msg.get("type", "text"),
            } if last_msg else None,
            "unread": 0,
        })

    # Sort by last message time (most recent first)
    result.sort(
        key=lambda c: c["last_message"]["timestamp"] if c["last_message"] else "",
        reverse=True
    )
    return jsonify(result)


@app.route("/api/conversations", methods=["POST"])
@login_required
def api_create_conversation():
    """Create a new direct or group conversation."""
    data = request.get_json()
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    members = data.get("members", [])
    if uid not in members:
        members.append(uid)

    conv_type = data.get("type", "direct")  # "direct" or "group"

    # For direct messages, check if conversation already exists
    if conv_type == "direct" and len(members) == 2:
        for cid, convo in convos.items():
            if convo["type"] == "direct" and set(convo["members"]) == set(members):
                return jsonify({"id": cid, "existing": True})

    cid = str(uuid.uuid4())
    convos[cid] = {
        "type": conv_type,
        "name": data.get("name", ""),
        "members": members,
        "admins": [uid] if conv_type == "group" else [],
        "created_at": now_iso(),
        "created_by": uid,
        "color": data.get("color", "#6c63ff"),
        "description": data.get("description", ""),
        "group_pic": "",
        "hidden_for": data.get("hidden_for", []),
    }
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"id": cid, "existing": False}), 201


@app.route("/api/conversations/<conversation_id>", methods=["DELETE"])
@login_required
def api_delete_conversation(conversation_id):
    """Delete a conversation and its messages."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if conversation_id not in convos:
        return jsonify({"error": "Conversation not found"}), 404
    convo = convos[conversation_id]
    if uid not in convo.get("members", []):
        return jsonify({"error": "Access denied"}), 403

    # Remove conversation and its messages
    del convos[conversation_id]
    write_json(CONVERSATIONS_FILE, convos)

    messages = read_json(MESSAGES_FILE)
    messages = [m for m in messages if m.get("conversation_id") != conversation_id]
    write_json(MESSAGES_FILE, messages)

    return jsonify({"ok": True})


@app.route("/api/messages/<conversation_id>")
@login_required
def api_get_messages(conversation_id):
    """Return all messages for a conversation."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if conversation_id not in convos:
        return jsonify({"error": "Conversation not found"}), 404
    if uid not in convos[conversation_id]["members"]:
        return jsonify({"error": "Access denied"}), 403

    messages = read_json(MESSAGES_FILE)
    users = read_json(USERS_FILE)
    convo_msgs = [m for m in messages if m["conversation_id"] == conversation_id]

    result = []
    for m in convo_msgs:
        # Skip messages deleted for this user
        if uid in m.get("deleted_for", []):
            continue

        sender = users.get(m["sender_id"], {})

        # Handle deleted-for-everyone messages
        if m.get("deleted_for_everyone"):
            msg_data = {
                "id": m["id"],
                "text": "",
                "type": "deleted",
                "sender_id": m["sender_id"],
                "sender_name": sender.get("username", "Unknown"),
                "avatar_color": sender.get("avatar_color", "#6c63ff"),
                "profile_pic": sender.get("profile_pic", ""),
                "timestamp": m["timestamp"],
                "is_mine": m["sender_id"] == uid,
                "deleted_for_everyone": True,
            }
            result.append(msg_data)
            continue

        msg_data = {
            "id": m["id"],
            "text": m.get("text", ""),
            "type": m.get("type", "text"),
            "sender_id": m["sender_id"],
            "sender_name": sender.get("username", "Unknown"),
            "avatar_color": sender.get("avatar_color", "#6c63ff"),
            "profile_pic": sender.get("profile_pic", ""),
            "timestamp": m["timestamp"],
            "is_mine": m["sender_id"] == uid,
            "edited": m.get("edited", False),
        }
        # Attach extra fields based on type
        if m.get("type") == "file":
            msg_data["file_url"] = m.get("file_url", "")
            msg_data["file_name"] = m.get("file_name", "")
            msg_data["file_type"] = m.get("file_type", "file")
            msg_data["file_size"] = m.get("file_size", 0)
        elif m.get("type") == "location":
            msg_data["latitude"] = m.get("latitude", 0)
            msg_data["longitude"] = m.get("longitude", 0)
        elif m.get("type") == "voice":
            msg_data["file_url"] = m.get("file_url", "")
            msg_data["duration"] = m.get("duration", 0)
        elif m.get("type") == "call":
            msg_data["call_type"] = m.get("call_type", "voice")
            msg_data["call_status"] = m.get("call_status", "ended")
            msg_data["call_duration"] = m.get("call_duration", 0)
        # For forwarded messages
        if m.get("forwarded"):
            msg_data["forwarded"] = True
            msg_data["forwarded_from"] = m.get("forwarded_from", "")
        # Server-side 15-minute window check.  Use UTC parsing helper so
        # Z‑terminated timestamps (new) and older naive strings are handled
        # consistently.
        try:
            msg_time = _parse_iso(m["timestamp"])
            elapsed = (datetime.utcnow() - msg_time).total_seconds()
        except (ValueError, TypeError):
            elapsed = 99999
        msg_type = m.get("type", "text")
        msg_data["can_edit"] = (m["sender_id"] == uid and msg_type == "text" and elapsed <= 900)
        msg_data["can_delete_for_everyone"] = (m["sender_id"] == uid and elapsed <= 900)

        # Read receipts: include read_by list and read count
        read_by = m.get("read_by", [])
        msg_data["read_by"] = read_by
        msg_data["read_count"] = len(read_by)
        result.append(msg_data)
    return jsonify(result)


@app.route("/api/messages/mark-read", methods=["POST"])
@login_required
def api_mark_messages_read():
    """Mark messages in a conversation as read by the current user."""
    uid = session["user_id"]
    data = request.get_json()
    conversation_id = data.get("conversation_id")

    if not conversation_id:
        return jsonify({"error": "conversation_id required"}), 400

    convos = read_json(CONVERSATIONS_FILE)
    if conversation_id not in convos:
        return jsonify({"error": "Conversation not found"}), 404
    if uid not in convos[conversation_id]["members"]:
        return jsonify({"error": "Access denied"}), 403

    messages = read_json(MESSAGES_FILE)
    changed = False
    for m in messages:
        if (m["conversation_id"] == conversation_id
                and m["sender_id"] != uid
                and uid not in m.get("read_by", [])):
            m.setdefault("read_by", []).append(uid)
            changed = True

    if changed:
        write_json(MESSAGES_FILE, messages)
    return jsonify({"ok": True})


@app.route("/api/messages/<message_id>/info")
@login_required
def api_message_info(message_id):
    """Return read-receipt details for a specific message."""
    uid = session["user_id"]
    messages = read_json(MESSAGES_FILE)
    users = read_json(USERS_FILE)

    msg = None
    for m in messages:
        if m["id"] == message_id:
            msg = m
            break

    if not msg:
        return jsonify({"error": "Message not found"}), 404

    # Verify the requester is in the conversation
    convos = read_json(CONVERSATIONS_FILE)
    cid = msg["conversation_id"]
    if cid not in convos or uid not in convos[cid]["members"]:
        return jsonify({"error": "Access denied"}), 403

    # Build read-by details
    read_by_details = []
    for reader_id in msg.get("read_by", []):
        reader = users.get(reader_id, {})
        read_by_details.append({
            "id": reader_id,
            "username": reader.get("username", "Unknown"),
            "avatar_color": reader.get("avatar_color", "#6c63ff"),
            "profile_pic": reader.get("profile_pic", ""),
        })

    # Total members in conversation (excluding sender)
    members = convos[cid].get("members", [])
    total_others = len([mid for mid in members if mid != msg["sender_id"]])

    return jsonify({
        "message_id": message_id,
        "read_by": read_by_details,
        "read_count": len(read_by_details),
        "total_recipients": total_others,
    })


@app.route("/api/messages/<message_id>/edit", methods=["PUT"])
@login_required
def api_edit_message(message_id):
    """Edit a message (only within 15 minutes, only by sender, only text messages)."""
    uid = session["user_id"]
    data = request.get_json()
    new_text = data.get("text", "").strip()

    if not new_text:
        return jsonify({"error": "Text required"}), 400

    messages = read_json(MESSAGES_FILE)
    for m in messages:
        if m["id"] == message_id:
            if m["sender_id"] != uid:
                return jsonify({"error": "You can only edit your own messages"}), 403
            if m.get("type", "text") != "text":
                return jsonify({"error": "Only text messages can be edited"}), 400
            if m.get("deleted_for_everyone"):
                return jsonify({"error": "Message already deleted"}), 400

            # Check 15-minute window (use UTC parser)
            msg_time = _parse_iso(m["timestamp"])
            elapsed = (datetime.utcnow() - msg_time).total_seconds()
            if elapsed > 900:  # 15 minutes = 900 seconds
                return jsonify({"error": "Messages can only be edited within 15 minutes"}), 400

            m["text"] = new_text
            m["edited"] = True
            write_json(MESSAGES_FILE, messages)
            return jsonify({"ok": True, "text": new_text})

    return jsonify({"error": "Message not found"}), 404


@app.route("/api/messages/<message_id>/delete-for-everyone", methods=["DELETE"])
@login_required
def api_delete_for_everyone(message_id):
    """Delete a message for everyone (only within 15 minutes, only by sender)."""
    uid = session["user_id"]
    messages = read_json(MESSAGES_FILE)

    for m in messages:
        if m["id"] == message_id:
            if m["sender_id"] != uid:
                return jsonify({"error": "You can only delete your own messages for everyone"}), 403
            if m.get("deleted_for_everyone"):
                return jsonify({"error": "Message already deleted"}), 400

            # Check 15-minute window (use UTC parser)
            msg_time = _parse_iso(m["timestamp"])
            elapsed = (datetime.utcnow() - msg_time).total_seconds()
            if elapsed > 900:
                return jsonify({"error": "Messages can only be deleted for everyone within 15 minutes"}), 400

            m["deleted_for_everyone"] = True
            m["text"] = ""
            write_json(MESSAGES_FILE, messages)
            return jsonify({"ok": True})

    return jsonify({"error": "Message not found"}), 404


@app.route("/api/messages/<message_id>/delete-for-me", methods=["DELETE"])
@login_required
def api_delete_for_me(message_id):
    """Delete a message for the current user only (no time limit)."""
    uid = session["user_id"]
    messages = read_json(MESSAGES_FILE)

    for m in messages:
        if m["id"] == message_id:
            if "deleted_for" not in m:
                m["deleted_for"] = []
            if uid not in m["deleted_for"]:
                m["deleted_for"].append(uid)
            write_json(MESSAGES_FILE, messages)
            return jsonify({"ok": True})

    return jsonify({"error": "Message not found"}), 404


@app.route("/api/messages/forward", methods=["POST"])
@login_required
def api_forward_messages():
    """Forward messages to one or more conversations."""
    uid = session["user_id"]
    data = request.get_json()
    message_ids = data.get("message_ids", [])
    target_conversation_ids = data.get("target_conversation_ids", [])

    if not message_ids or not target_conversation_ids:
        return jsonify({"error": "message_ids and target_conversation_ids required"}), 400

    messages = read_json(MESSAGES_FILE)
    convos = read_json(CONVERSATIONS_FILE)
    users = read_json(USERS_FILE)
    sender = users.get(uid, {})

    # Gather source messages
    source_msgs = []
    for m in messages:
        if m["id"] in message_ids and not m.get("deleted_for_everyone"):
            source_msgs.append(m)

    if not source_msgs:
        return jsonify({"error": "No valid messages to forward"}), 400

    forwarded = []
    for cid in target_conversation_ids:
        if cid not in convos:
            continue
        if uid not in convos[cid]["members"]:
            continue

        for src in source_msgs:
            new_msg = {
                "id": str(uuid.uuid4()),
                "conversation_id": cid,
                "sender_id": uid,
                "type": src.get("type", "text"),
                "text": src.get("text", ""),
                "timestamp": now_iso(),
                "forwarded": True,
                "forwarded_from": users.get(src["sender_id"], {}).get("username", "Unknown"),
            }
            # Copy extra fields
            for key in ("file_url", "file_name", "file_type", "file_size",
                        "latitude", "longitude", "duration"):
                if key in src:
                    new_msg[key] = src[key]

            messages.append(new_msg)
            forwarded.append(new_msg["id"])

    write_json(MESSAGES_FILE, messages)
    return jsonify({"ok": True, "forwarded_count": len(forwarded)}), 201


@app.route("/api/messages", methods=["POST"])
@login_required
def api_send_message():
    """Send a new message to a conversation (text, location).

    If `conversation_id` is not provided but `recipient_id` is, we will
    lazily create a direct conversation between the sender and recipient
    (only when the first message is sent).
    """
    data = request.get_json()
    uid = session["user_id"]
    conversation_id = data.get("conversation_id")
    recipient_id = data.get("recipient_id")
    msg_type = data.get("type", "text")

    # Allow lazy creation of direct conversation when messaging a user
    if not conversation_id and recipient_id:
        # Find existing direct convo
        convos = read_json(CONVERSATIONS_FILE)
        for cid, convo in convos.items():
            if convo.get("type") == "direct" and set(convo.get("members", [])) == {uid, recipient_id}:
                conversation_id = cid
                break

        if not conversation_id:
            # Create a new direct conversation and hide it from the recipient until a message is sent
            cid = str(uuid.uuid4())
            convos[cid] = {
                "type": "direct",
                "name": "",
                "members": [uid, recipient_id],
                "admins": [],
                "created_at": now_iso(),
                "created_by": uid,
                "color": "#6c63ff",
                "description": "",
                "group_pic": "",
                "hidden_for": [recipient_id],
            }
            write_json(CONVERSATIONS_FILE, convos)
            conversation_id = cid

    if not conversation_id:
        return jsonify({"error": "conversation_id required"}), 400

    convos = read_json(CONVERSATIONS_FILE)
    if conversation_id not in convos:
        return jsonify({"error": "Conversation not found"}), 404
    if uid not in convos[conversation_id]["members"]:
        return jsonify({"error": "Access denied"}), 403

    messages = read_json(MESSAGES_FILE)
    users = read_json(USERS_FILE)
    sender = users.get(uid, {})

    msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "sender_id": uid,
        "type": msg_type,
        "timestamp": now_iso(),
    }

    if msg_type == "text":
        text = data.get("text", "").strip()
        if not text:
            return jsonify({"error": "Text required"}), 400
        msg["text"] = text
    elif msg_type == "location":
        msg["text"] = data.get("text", "Shared a location")
        msg["latitude"] = data.get("latitude", 0)
        msg["longitude"] = data.get("longitude", 0)
    elif msg_type == "call":
        msg["text"] = data.get("text", "Call")
        msg["call_type"] = data.get("call_type", "voice")
        msg["call_status"] = data.get("call_status", "ended")
        msg["call_duration"] = data.get("call_duration", 0)
    else:
        msg["text"] = data.get("text", "")

    # Support hiding a message from specific users (e.g. missed call message hidden from caller)
    deleted_for = data.get("deleted_for")
    if isinstance(deleted_for, list):
        msg["deleted_for"] = deleted_for

    messages.append(msg)
    write_json(MESSAGES_FILE, messages)

    # If conversation was hidden from the recipient, unhide it now that a message was sent.
    convos = read_json(CONVERSATIONS_FILE)
    convo = convos.get(conversation_id)
    if convo and convo.get("type") == "direct":
        hidden = convo.get("hidden_for", [])
        if hidden:
            convos[conversation_id]["hidden_for"] = []
            write_json(CONVERSATIONS_FILE, convos)

    resp = {
        "conversation_id": conversation_id,
        "id": msg["id"],
        "text": msg.get("text", ""),
        "type": msg_type,
        "sender_id": uid,
        "sender_name": sender.get("username", "Unknown"),
        "avatar_color": sender.get("avatar_color", "#6c63ff"),
        "profile_pic": sender.get("profile_pic", ""),
        "timestamp": msg["timestamp"],
        "is_mine": True,
    }
    if msg_type == "location":
        resp["latitude"] = msg["latitude"]
        resp["longitude"] = msg["longitude"]
    elif msg_type == "call":
        resp["call_type"] = msg["call_type"]
        resp["call_status"] = msg["call_status"]
        resp["call_duration"] = msg["call_duration"]

    return jsonify(resp), 201


@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload_file():
    """Upload a file (image, video, document, voice note) and create a message."""
    uid = session["user_id"]
    conversation_id = request.form.get("conversation_id")
    msg_type = request.form.get("type", "file")  # "file" or "voice"

    if not conversation_id:
        return jsonify({"error": "conversation_id required"}), 400

    convos = read_json(CONVERSATIONS_FILE)
    if conversation_id not in convos:
        return jsonify({"error": "Conversation not found"}), 404
    if uid not in convos[conversation_id]["members"]:
        return jsonify({"error": "Access denied"}), 403

    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    # Generate unique filename
    original_name = secure_filename(file.filename) or "upload"
    ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'bin'
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = os.path.join(UPLOADS_DIR, unique_name)
    file.save(file_path)

    file_size = os.path.getsize(file_path)
    file_type_cat = get_file_type(original_name)
    file_url = f"/uploads/{unique_name}"

    messages = read_json(MESSAGES_FILE)
    users = read_json(USERS_FILE)
    sender = users.get(uid, {})

    # Build label text
    if msg_type == "voice":
        display_text = "Voice message"
    else:
        display_text = original_name

    msg = {
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "sender_id": uid,
        "type": msg_type,
        "text": display_text,
        "file_url": file_url,
        "file_name": original_name,
        "file_type": file_type_cat,
        "file_size": file_size,
        "duration": float(request.form.get("duration", 0)),
        "timestamp": now_iso(),
    }
    messages.append(msg)
    write_json(MESSAGES_FILE, messages)

    return jsonify({
        "id": msg["id"],
        "text": display_text,
        "type": msg_type,
        "file_url": file_url,
        "file_name": original_name,
        "file_type": file_type_cat,
        "file_size": file_size,
        "duration": msg["duration"],
        "sender_id": uid,
        "sender_name": sender.get("username", "Unknown"),
        "avatar_color": sender.get("avatar_color", "#6c63ff"),
        "profile_pic": sender.get("profile_pic", ""),
        "timestamp": msg["timestamp"],
        "is_mine": True,
    }), 201


@app.route("/uploads/<filename>")
@login_required
def serve_upload(filename):
    """Serve uploaded files."""
    return send_from_directory(UPLOADS_DIR, filename)


@app.route("/api/profile", methods=["GET", "PUT"])
@login_required
def api_profile():
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    user = users.get(uid, {})

    if request.method == "PUT":
        data = request.get_json()
        if "bio" in data:
            users[uid]["bio"] = data["bio"][:200]
        if "avatar_color" in data:
            users[uid]["avatar_color"] = data["avatar_color"]
        write_json(USERS_FILE, users)
        user = users[uid]

    return jsonify({
        "id": uid,
        "username": user["username"],
        "email": user.get("email", ""),
        "email_verified": user.get("email_verified", False),
        "bio": user.get("bio", ""),
        "avatar_color": user.get("avatar_color", "#6c63ff"),
        "profile_pic": user.get("profile_pic", ""),
        "created_at": user.get("created_at", ""),
    })


@app.route("/api/profile/picture", methods=["POST"])
@login_required
def api_profile_picture():
    """Upload or update profile picture."""
    uid = session["user_id"]
    if "picture" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["picture"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    original_name = secure_filename(file.filename) or "avatar"
    ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'png'
    if ext not in ('png', 'jpg', 'jpeg', 'gif', 'webp'):
        return jsonify({"error": "Only image files allowed"}), 400

    unique_name = f"pfp_{uid}_{uuid.uuid4().hex[:8]}.{ext}"
    file_path = os.path.join(UPLOADS_DIR, unique_name)
    file.save(file_path)

    users = read_json(USERS_FILE)
    # Delete old profile pic file if exists
    old_pic = users.get(uid, {}).get("profile_pic", "")
    if old_pic:
        old_path = os.path.join(UPLOADS_DIR, old_pic.replace("/uploads/", ""))
        if os.path.exists(old_path):
            os.remove(old_path)

    users[uid]["profile_pic"] = f"/uploads/{unique_name}"
    write_json(USERS_FILE, users)

    return jsonify({"profile_pic": users[uid]["profile_pic"]}), 200


@app.route("/api/profile/picture", methods=["DELETE"])
@login_required
def api_remove_profile_picture():
    """Remove profile picture."""
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    old_pic = users.get(uid, {}).get("profile_pic", "")
    if old_pic:
        old_path = os.path.join(UPLOADS_DIR, old_pic.replace("/uploads/", ""))
        if os.path.exists(old_path):
            os.remove(old_path)
    users[uid]["profile_pic"] = ""
    write_json(USERS_FILE, users)
    return jsonify({"ok": True})


@app.route("/api/users/<user_id>/profile")
@login_required
def api_user_profile(user_id):
    """Return public profile info for any user."""
    users = read_json(USERS_FILE)
    user = users.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({
        "id": user_id,
        "username": user["username"],
        "bio": user.get("bio", ""),
        "avatar_color": user.get("avatar_color", "#6c63ff"),
        "profile_pic": user.get("profile_pic", ""),
        "online": is_user_online(user),
        "last_seen": user.get("last_seen", ""),
        "created_at": user.get("created_at", ""),
    })


@app.route("/api/profile/username", methods=["PUT"])
@login_required
def api_change_username():
    """Change username."""
    uid = session["user_id"]
    data = request.get_json()
    new_username = data.get("username", "").strip()

    if not new_username or len(new_username) < 3:
        return jsonify({"error": "Username must be at least 3 characters."}), 400
    if len(new_username) > 30:
        return jsonify({"error": "Username too long."}), 400

    users = read_json(USERS_FILE)
    # Check duplicate
    for user_id, u in users.items():
        if user_id != uid and u["username"].lower() == new_username.lower():
            return jsonify({"error": "Username already taken."}), 409

    users[uid]["username"] = new_username
    write_json(USERS_FILE, users)
    session["username"] = new_username
    return jsonify({"ok": True, "username": new_username})


@app.route("/api/profile/password", methods=["PUT"])
@login_required
def api_change_password():
    """Change password."""
    uid = session["user_id"]
    data = request.get_json()
    current_pw = data.get("current_password", "")
    new_pw = data.get("new_password", "")
    confirm_pw = data.get("confirm_password", "")

    if not current_pw or not new_pw:
        return jsonify({"error": "All fields are required."}), 400
    if len(new_pw) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if new_pw != confirm_pw:
        return jsonify({"error": "New passwords do not match."}), 400

    users = read_json(USERS_FILE)
    if hash_password(current_pw) != users[uid]["password"]:
        return jsonify({"error": "Current password is incorrect."}), 403

    users[uid]["password"] = hash_password(new_pw)
    write_json(USERS_FILE, users)
    return jsonify({"ok": True})


@app.route("/api/profile/email/request", methods=["POST"])
@login_required
def api_profile_email_request():
    """Send or resend an email verification OTP."""
    uid = session["user_id"]
    data = request.get_json() or {}
    email = (data.get("email") or "").strip()

    users = read_json(USERS_FILE)

    if email:
        # Validate format
        if "@" not in email or "." not in email:
            return jsonify({"error": "Invalid email address."}), 400

        # Ensure no other user has verified this email
        for user_id, u in users.items():
            if user_id != uid and u.get("email", "").lower() == email.lower() and u.get("email_verified"):
                return jsonify({"error": "Email is already in use."}), 409

    else:
        # No email provided: use existing email on file if present.
        email = users.get(uid, {}).get("email", "")
        if not email:
            return jsonify({"error": "No email provided."}), 400

    otp = _generate_otp(6)
    expires_at = (datetime.utcnow() + timedelta(minutes=15)).isoformat()

    tokens = _read_email_otps()
    tokens[uid] = {"email": email, "otp": otp, "expires_at": expires_at}
    _write_email_otps(tokens)

    email_sent = _send_email(
        email,
        "QuickChat email verification code",
        f"Your QuickChat verification code is: {otp}\n\nThis code expires in 15 minutes."
    )

    if not email_sent:
        return jsonify({"ok": True, "otp": otp})

    return jsonify({"ok": True})


@app.route("/api/profile/email/confirm", methods=["POST"])
@login_required
def api_profile_email_confirm():
    """Confirm an email verification OTP and set the verified email."""
    uid = session["user_id"]
    data = request.get_json() or {}
    otp = (data.get("otp") or "").strip()

    if not otp:
        return jsonify({"error": "OTP is required."}), 400

    tokens = _read_email_otps()
    token = tokens.get(uid)
    if not token or token.get("otp") != otp:
        return jsonify({"error": "Invalid OTP."}), 400

    users = read_json(USERS_FILE)
    users[uid]["email"] = token.get("email", "")
    users[uid]["email_verified"] = True
    write_json(USERS_FILE, users)

    tokens.pop(uid, None)
    _write_email_otps(tokens)

    return jsonify({"ok": True})


@app.route("/api/search/users")
@login_required
def api_search_users():
    """Search users by username."""
    query = request.args.get("q", "").lower().strip()
    users = read_json(USERS_FILE)
    uid = session["user_id"]
    results = []
    for user_id, u in users.items():
        if user_id == uid:
            continue
        if query in u["username"].lower():
            results.append({
                "id": user_id,
                "username": u["username"],
                "avatar_color": u.get("avatar_color", "#6c63ff"),
                "profile_pic": u.get("profile_pic", ""),
                "online": is_user_online(u),
            })
    return jsonify(results)


# ========================
#  Typing Indicator (in-memory, no file I/O)
# ========================

# { conversation_id: { user_id: last_typing_timestamp } }
_typing_status = {}

@app.route("/api/typing", methods=["POST"])
@login_required
def api_typing():
    """Report that the current user is typing in a conversation."""
    uid = session["user_id"]
    data = request.get_json()
    conversation_id = data.get("conversation_id", "")
    if not conversation_id:
        return jsonify({"error": "conversation_id required"}), 400
    _typing_status.setdefault(conversation_id, {})[uid] = datetime.now()
    return jsonify({"ok": True})


@app.route("/api/typing/<conversation_id>")
@login_required
def api_typing_status(conversation_id):
    """Return list of users currently typing in this conversation (within last 4s)."""
    uid = session["user_id"]
    now = datetime.now()
    typers = []
    convo_typing = _typing_status.get(conversation_id, {})
    expired = []
    users = read_json(USERS_FILE)
    for typer_id, ts in convo_typing.items():
        if typer_id == uid:
            continue  # Don't show yourself
        if (now - ts).total_seconds() < 4:
            u = users.get(typer_id, {})
            typers.append(u.get("username", "Someone"))
        else:
            expired.append(typer_id)
    # Clean up expired entries
    for e in expired:
        convo_typing.pop(e, None)
    return jsonify({"typing": typers})


# ========================
#  Online Heartbeat
# ========================

@app.route("/api/heartbeat", methods=["POST"])
@login_required
def api_heartbeat():
    """Update user's online status and last_seen timestamp."""
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    if uid in users:
        users[uid]["online"] = True
        users[uid]["last_seen"] = now_iso()
        write_json(USERS_FILE, users)
    return jsonify({"ok": True})


@app.route("/api/user/<user_id>/status")
@login_required
def api_user_status(user_id):
    """Get a specific user's online status."""
    users = read_json(USERS_FILE)
    user = users.get(user_id, {})
    return jsonify({
        "online": is_user_online(user),
        "last_seen": user.get("last_seen", ""),
        "bio": user.get("bio", ""),
    })


# ========================
#  Stories API
# ========================

@app.route("/api/stories")
@login_required
def api_get_stories():
    """Get all visible stories for current user (within 24h)."""
    uid = session["user_id"]
    users = read_json(USERS_FILE)
    stories = read_json(STORIES_FILE)
    now = datetime.utcnow()

    visible = []
    for story in stories:
        # Check if story is within 24 hours
        story_time = _parse_iso(story["created_at"])
        if (now - story_time).total_seconds() > 86400:
            continue

        # Check privacy
        privacy = story.get("privacy", "everyone")
        author_id = story["user_id"]

        if author_id == uid:
            pass  # Always show own stories
        elif privacy == "everyone":
            # Show only to people who share a conversation with author
            convos = read_json(CONVERSATIONS_FILE)
            is_contact = False
            for c in convos.values():
                if author_id in c["members"] and uid in c["members"]:
                    is_contact = True
                    break
            if not is_contact:
                continue
        elif privacy == "custom":
            # Show only to users in allowed_users list
            allowed = story.get("allowed_users", [])
            if uid not in allowed:
                continue
        else:
            continue  # Unknown privacy, skip

        author = users.get(author_id, {})
        # username may be stored directly on the story (legacy or to lock
        # the name at the time of posting). fall back to the current user
        # record if it's missing.
        username = story.get("username") or author.get("username", "Unknown")

        visible.append({
            "id": story["id"],
            "user_id": author_id,
            "username": username,
            "avatar_color": author.get("avatar_color", "#6c63ff"),
            "profile_pic": author.get("profile_pic", ""),
            "content_type": story.get("content_type", "text"),
            "text": story.get("text", ""),
            "media_url": story.get("media_url", ""),
            "bg_color": story.get("bg_color", "#6c63ff"),
            "privacy": story.get("privacy", "everyone"),
            "created_at": story["created_at"],
            "is_mine": author_id == uid,
            "views": story.get("views", []),
            "view_count": len(story.get("views", [])),
            "duration": story.get("duration", 0),
        })

    # Group by user
    grouped = {}
    for s in visible:
        uid_key = s["user_id"]
        if uid_key not in grouped:
            grouped[uid_key] = {
                "user_id": uid_key,
                "username": s["username"],
                "avatar_color": s["avatar_color"],
                "profile_pic": s.get("profile_pic", ""),
                "is_mine": s["is_mine"],
                "stories": [],
            }
        grouped[uid_key]["stories"].append(s)

    # Sort: my stories first, then by latest
    result = sorted(grouped.values(), key=lambda g: (not g["is_mine"], -len(g["stories"])))
    return jsonify(result)


@app.route("/api/stories", methods=["POST"])
@login_required
def api_create_story():
    """Create a new text or media story."""
    uid = session["user_id"]
    stories = read_json(STORIES_FILE)

    content_type = request.form.get("content_type", "text")
    text = request.form.get("text", "")
    bg_color = request.form.get("bg_color", "#6c63ff")
    privacy = request.form.get("privacy", "everyone")
    allowed_users_raw = request.form.get("allowed_users", "")
    allowed_users = [u.strip() for u in allowed_users_raw.split(",") if u.strip()] if allowed_users_raw else []

    users = read_json(USERS_FILE)
    username = users.get(uid, {}).get("username", "Unknown")
    story = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "username": username,
        "content_type": content_type,
        "text": text,
        "media_url": "",
        "bg_color": bg_color,
        "privacy": privacy,
        "allowed_users": allowed_users,
        "created_at": now_iso(),
        "views": [],
    }

    # Handle media upload
    if "media" in request.files:
        file = request.files["media"]
        if file.filename:
            original_name = secure_filename(file.filename) or "story"
            ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'bin'
            unique_name = f"story_{uuid.uuid4().hex}.{ext}"
            file_path = os.path.join(UPLOADS_DIR, unique_name)
            file.save(file_path)
            story["media_url"] = f"/uploads/{unique_name}"
            is_video = ext not in ('png', 'jpg', 'jpeg', 'gif', 'webp')
            story["content_type"] = "video" if is_video else "image"
            if is_video:
                # optional duration sent by client
                try:
                    dur = float(request.form.get("duration", 0))
                except (ValueError, TypeError):
                    dur = 0
                # enforce 60s maximum
                if dur > 60:
                    return jsonify({"error": "Video too long (max 60 seconds)"}), 400
                if dur > 0:
                    story["duration"] = dur

    stories.append(story)
    write_json(STORIES_FILE, stories)
    return jsonify(story), 201


@app.route("/api/stories/<story_id>/view", methods=["POST"])
@login_required
def api_view_story(story_id):
    """Mark a story as viewed by the current user."""
    uid = session["user_id"]
    stories = read_json(STORIES_FILE)
    for story in stories:
        if story["id"] == story_id:
            if uid not in story.get("views", []):
                story.setdefault("views", []).append(uid)
                write_json(STORIES_FILE, stories)
            break
    return jsonify({"ok": True})


@app.route("/api/stories/<story_id>", methods=["DELETE"])
@login_required
def api_delete_story(story_id):
    """Delete a story (only by owner)."""
    uid = session["user_id"]
    stories = read_json(STORIES_FILE)
    stories = [s for s in stories if not (s["id"] == story_id and s["user_id"] == uid)]
    write_json(STORIES_FILE, stories)
    return jsonify({"ok": True})


# ========================
#  Call Signaling API
# ========================

@app.route("/api/call/initiate", methods=["POST"])
@login_required
def api_call_initiate():
    """Initiate a call to another user."""
    data = request.get_json()
    uid = session["user_id"]
    target_id = data.get("target_id")
    call_type = data.get("call_type", "voice")  # "voice" or "video"
    offer = data.get("offer")  # WebRTC offer SDP

    if not target_id or not offer:
        return jsonify({"error": "target_id and offer required"}), 400

    users = read_json(USERS_FILE)
    caller = users.get(uid, {})

    calls = read_json(CALLS_FILE)
    call_id = str(uuid.uuid4())
    calls[call_id] = {
        "caller_id": uid,
        "caller_name": caller.get("username", "Unknown"),
        "caller_color": caller.get("avatar_color", "#6c63ff"),
        "target_id": target_id,
        "call_type": call_type,
        "status": "ringing",  # ringing, answered, ended
        "offer": offer,
        "answer": None,
        "ice_candidates_caller": [],
        "ice_candidates_target": [],
        "created_at": now_iso(),
    }
    write_json(CALLS_FILE, calls)
    return jsonify({"call_id": call_id}), 201


@app.route("/api/call/check")
@login_required
def api_call_check():
    """Check if there is an incoming call for the current user."""
    uid = session["user_id"]
    calls = read_json(CALLS_FILE)

    for call_id, call in calls.items():
        if call["target_id"] == uid and call["status"] == "ringing":
            return jsonify({
                "call_id": call_id,
                "caller_id": call["caller_id"],
                "caller_name": call["caller_name"],
                "caller_color": call["caller_color"],
                "call_type": call["call_type"],
                "offer": call["offer"],
            })

    return jsonify({"call_id": None})


@app.route("/api/call/<call_id>/answer", methods=["POST"])
@login_required
def api_call_answer(call_id):
    """Answer an incoming call with WebRTC answer SDP."""
    data = request.get_json()
    uid = session["user_id"]
    answer = data.get("answer")

    calls = read_json(CALLS_FILE)
    if call_id not in calls:
        return jsonify({"error": "Call not found"}), 404

    call = calls[call_id]
    if call["target_id"] != uid:
        return jsonify({"error": "Not your call"}), 403

    calls[call_id]["answer"] = answer
    calls[call_id]["status"] = "answered"
    write_json(CALLS_FILE, calls)
    return jsonify({"ok": True})


@app.route("/api/call/<call_id>/answer-check")
@login_required
def api_call_answer_check(call_id):
    """Caller polls to see if their call was answered."""
    calls = read_json(CALLS_FILE)
    if call_id not in calls:
        return jsonify({"status": "ended"})

    call = calls[call_id]
    return jsonify({
        "status": call["status"],
        "answer": call.get("answer"),
        "ice_candidates": call.get("ice_candidates_target", []),
    })


@app.route("/api/call/<call_id>/ice", methods=["POST"])
@login_required
def api_call_ice(call_id):
    """Add an ICE candidate."""
    data = request.get_json()
    uid = session["user_id"]
    candidate = data.get("candidate")

    calls = read_json(CALLS_FILE)
    if call_id not in calls:
        return jsonify({"error": "Call not found"}), 404

    call = calls[call_id]
    if uid == call["caller_id"]:
        calls[call_id]["ice_candidates_caller"].append(candidate)
    elif uid == call["target_id"]:
        calls[call_id]["ice_candidates_target"].append(candidate)

    write_json(CALLS_FILE, calls)
    return jsonify({"ok": True})


@app.route("/api/call/<call_id>/ice-poll")
@login_required
def api_call_ice_poll(call_id):
    """Get ICE candidates from the other peer."""
    uid = session["user_id"]
    calls = read_json(CALLS_FILE)
    if call_id not in calls:
        return jsonify({"candidates": [], "status": "ended"})

    call = calls[call_id]
    # Return the OTHER side's candidates
    if uid == call["caller_id"]:
        candidates = call.get("ice_candidates_target", [])
    else:
        candidates = call.get("ice_candidates_caller", [])

    return jsonify({"candidates": candidates, "status": call["status"]})


@app.route("/api/call/<call_id>/end", methods=["POST"])
@login_required
def api_call_end(call_id):
    """End / reject a call."""
    calls = read_json(CALLS_FILE)
    if call_id in calls:
        calls[call_id]["status"] = "ended"
        write_json(CALLS_FILE, calls)
    return jsonify({"ok": True})


# ========================
#  Group Management APIs
# ========================

@app.route("/api/groups/<group_id>/info")
@login_required
def api_group_info(group_id):
    """Return detailed group info including members with usernames and admin status."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)
    users = read_json(USERS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    if uid not in convo["members"]:
        return jsonify({"error": "Access denied"}), 403

    admins = convo.get("admins", [convo.get("created_by", "")])
    member_details = []
    for mid in convo["members"]:
        u = users.get(mid, {})
        member_details.append({
            "id": mid,
            "username": u.get("username", "Unknown"),
            "avatar_color": u.get("avatar_color", "#6c63ff"),
            "profile_pic": u.get("profile_pic", ""),
            "online": is_user_online(u),
            "is_admin": mid in admins,
            "is_creator": mid == convo.get("created_by", ""),
        })

    # Sort: creator first, then admins, then members
    member_details.sort(key=lambda m: (not m["is_creator"], not m["is_admin"], m["username"].lower()))

    return jsonify({
        "id": group_id,
        "name": convo.get("name", ""),
        "description": convo.get("description", ""),
        "color": convo.get("color", "#6c63ff"),
        "group_pic": convo.get("group_pic", ""),
        "created_by": convo.get("created_by", ""),
        "created_at": convo.get("created_at", ""),
        "admins": admins,
        "members": member_details,
        "is_admin": uid in admins,
        "is_creator": uid == convo.get("created_by", ""),
        "member_count": len(convo["members"]),
    })


@app.route("/api/groups/<group_id>/update", methods=["PUT"])
@login_required
def api_group_update(group_id):
    """Update group name, description, color (admin only)."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can update group info"}), 403

    data = request.get_json()
    if "name" in data and data["name"].strip():
        convo["name"] = data["name"].strip()
    if "description" in data:
        convo["description"] = data["description"].strip()
    if "color" in data:
        convo["color"] = data["color"]

    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


@app.route("/api/groups/<group_id>/picture", methods=["POST"])
@login_required
def api_group_picture(group_id):
    """Upload or update group profile picture (admin only)."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can change group picture"}), 403

    if "picture" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    file = request.files["picture"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    original_name = secure_filename(file.filename) or "group"
    ext = original_name.rsplit('.', 1)[-1].lower() if '.' in original_name else 'png'
    if ext not in ('png', 'jpg', 'jpeg', 'gif', 'webp'):
        return jsonify({"error": "Only image files allowed"}), 400

    unique_name = f"grp_{group_id[:8]}_{uuid.uuid4().hex[:8]}.{ext}"
    file_path = os.path.join(UPLOADS_DIR, unique_name)
    file.save(file_path)

    # Delete old group pic
    old_pic = convo.get("group_pic", "")
    if old_pic:
        old_path = os.path.join(UPLOADS_DIR, old_pic.replace("/uploads/", ""))
        if os.path.exists(old_path):
            os.remove(old_path)

    convo["group_pic"] = f"/uploads/{unique_name}"
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"group_pic": convo["group_pic"]})


@app.route("/api/groups/<group_id>/picture", methods=["DELETE"])
@login_required
def api_group_remove_picture(group_id):
    """Remove group picture (admin only)."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can remove group picture"}), 403

    old_pic = convo.get("group_pic", "")
    if old_pic:
        old_path = os.path.join(UPLOADS_DIR, old_pic.replace("/uploads/", ""))
        if os.path.exists(old_path):
            os.remove(old_path)
    convo["group_pic"] = ""
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


@app.route("/api/groups/<group_id>/members", methods=["POST"])
@login_required
def api_group_add_member(group_id):
    """Add a member to the group (admin only)."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)
    users = read_json(USERS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can add members"}), 403

    data = request.get_json()
    member_id = data.get("member_id", "")
    if member_id not in users:
        return jsonify({"error": "User not found"}), 404
    if member_id in convo["members"]:
        return jsonify({"error": "Already a member"}), 400

    convo["members"].append(member_id)
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True, "username": users[member_id]["username"]})


@app.route("/api/groups/<group_id>/members/<member_id>", methods=["DELETE"])
@login_required
def api_group_remove_member(group_id, member_id):
    """Remove a member from the group (admin only). Cannot remove creator."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can remove members"}), 403
    if member_id == convo.get("created_by"):
        return jsonify({"error": "Cannot remove the group creator"}), 403
    if member_id not in convo["members"]:
        return jsonify({"error": "Not a member"}), 400

    convo["members"].remove(member_id)
    # Also remove from admins if they were admin
    if member_id in convo.get("admins", []):
        convo["admins"].remove(member_id)
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


@app.route("/api/groups/<group_id>/admins", methods=["POST"])
@login_required
def api_group_make_admin(group_id):
    """Make a member an admin (admin only)."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can promote members"}), 403

    data = request.get_json()
    member_id = data.get("member_id", "")
    if member_id not in convo["members"]:
        return jsonify({"error": "Not a member of this group"}), 400
    if member_id in admins:
        return jsonify({"error": "Already an admin"}), 400

    if "admins" not in convo:
        convo["admins"] = [convo.get("created_by", "")]
    convo["admins"].append(member_id)
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


@app.route("/api/groups/<group_id>/admins/<member_id>", methods=["DELETE"])
@login_required
def api_group_remove_admin(group_id, member_id):
    """Remove admin status from a member (admin only). Cannot demote creator."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    admins = convo.get("admins", [convo.get("created_by", "")])
    if uid not in admins:
        return jsonify({"error": "Only admins can demote admins"}), 403
    if member_id == convo.get("created_by"):
        return jsonify({"error": "Cannot remove admin from group creator"}), 403
    if member_id not in admins:
        return jsonify({"error": "Not an admin"}), 400

    convo["admins"].remove(member_id)
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


@app.route("/api/groups/<group_id>/leave", methods=["POST"])
@login_required
def api_group_leave(group_id):
    """Leave a group. If creator leaves, ownership transfers to next admin or oldest member."""
    uid = session["user_id"]
    convos = read_json(CONVERSATIONS_FILE)

    if group_id not in convos:
        return jsonify({"error": "Group not found"}), 404
    convo = convos[group_id]
    if convo["type"] != "group":
        return jsonify({"error": "Not a group"}), 400
    if uid not in convo["members"]:
        return jsonify({"error": "Not a member"}), 400

    convo["members"].remove(uid)
    if uid in convo.get("admins", []):
        convo["admins"].remove(uid)

    # If creator left, transfer ownership
    if uid == convo.get("created_by") and convo["members"]:
        # Pick next admin, or first member
        new_owner = convo["admins"][0] if convo.get("admins") else convo["members"][0]
        convo["created_by"] = new_owner
        if new_owner not in convo.get("admins", []):
            convo.setdefault("admins", []).append(new_owner)

    # Delete group if empty
    if not convo["members"]:
        del convos[group_id]
    
    write_json(CONVERSATIONS_FILE, convos)
    return jsonify({"ok": True})


# ========================
#  Entry point
# ========================

# Always ensure data files exist (needed for both local dev and hosted WSGI)
ensure_data_files()

# ---------------------------------------------------------------------------
# Data migrations
# ---------------------------------------------------------------------------

def _migrate_story_usernames():
    stories = read_json(STORIES_FILE)
    users = read_json(USERS_FILE)
    changed = False
    for s in stories:
        if not s.get("username"):
            s["username"] = users.get(s.get("user_id", ""), {}).get("username", "Unknown")
            changed = True
    if changed:
        write_json(STORIES_FILE, stories)


def _migrate_user_timestamps():
    """Append a UTC designator to existing last_seen values.

    Prior to the timezone fixes we stored naive local timestamps; clients
    interpreting them as UTC would show a constant offset (e.g. five hours
    ago).  Adding a trailing ``Z`` makes the values unambiguous and keeps the
    display accurate.  This runs once at startup if any user records need
    updating.
    """
    users = read_json(USERS_FILE)
    changed = False
    for u in users.values():
        ts = u.get("last_seen", "")
        # naive ISO8601 without offset looks like YYYY-MM-DDTHH:MM:SS...
        if ts and not ts.endswith("Z") and "+" not in ts and "-" not in ts[19:]:
            u["last_seen"] = ts + "Z"
            changed = True
    if changed:
        write_json(USERS_FILE, users)

# run migrations
_migrate_story_usernames()
_migrate_user_timestamps()

if __name__ == "__main__":
    print("\n  🚀  Messaging App running at http://127.0.0.1:5000\n")
    app.run(debug=True, port=5000)
