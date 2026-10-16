"""Student-list parsing, access-code generation and email/SMS delivery for the
Exam module. Pure helpers: no database access in this file.
"""
import base64
import csv
import html
import io
import os
import re
import secrets
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage

EMAIL_FIND = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
DEFAULT_CC = os.getenv("DEFAULT_COUNTRY_CODE", "+91")
CODE_PREFIX = os.getenv("INVITE_CODE_PREFIX", "EXAM")
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I to avoid typos


# ------------------------------------------------------------------ codes
def new_code() -> str:
    body = "".join(secrets.choice(_ALPHABET) for _ in range(8))
    return f"{CODE_PREFIX}-{body[:4]}-{body[4:]}"


# ------------------------------------------------------------------ reading files
def read_rows(filename: str, data: bytes) -> list[list[str]]:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
        except ImportError:
            raise ValueError("Excel files need 'pip install openpyxl' (or save the sheet as CSV).")
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.active
        return [["" if c is None else str(c).strip() for c in row] for row in ws.iter_rows(values_only=True)]
    if name.endswith((".csv", ".tsv", ".txt")):
        text = None
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            delim = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
        except csv.Error:
            delim = ","
        return [[c.strip() for c in row] for row in csv.reader(io.StringIO(text), delimiter=delim)]
    raise ValueError("Please upload a .csv or .xlsx file")


# ------------------------------------------------------------------ cleaning
def find_email(cell: str) -> str:
    m = EMAIL_FIND.search(cell or "")
    return m.group(0).lower() if m else ""


def normalize_phone(cell: str) -> str:
    v = re.sub(r"\.0$", "", (cell or "").strip())  # Excel turns 98765... into 98765....0
    digits = re.sub(r"\D", "", v)
    if not digits:
        return ""
    if v.startswith("+"):
        return "+" + digits if 11 <= len(digits) <= 15 else ""
    if len(digits) == 10 and digits[0] in "6789":
        return DEFAULT_CC + digits
    if len(digits) == 12 and digits.startswith("91") and digits[2] in "6789":
        return "+" + digits
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        return DEFAULT_CC + digits[1:]
    return ""


def _detect_columns(header: list[str], body: list[list[str]], ncols: int) -> dict:
    idx = {"email": None, "phone": None, "name": None, "roll": None}
    low = [h.lower() for h in header] + [""] * (ncols - len(header))
    for i, k in enumerate(low):
        if idx["email"] is None and "mail" in k:
            idx["email"] = i
        elif idx["phone"] is None and any(w in k for w in ("phone", "mobile", "contact", "whatsapp", "cell")):
            idx["phone"] = i
        elif idx["name"] is None and "name" in k and not any(
            w in k for w in ("father", "mother", "parent", "guardian", "user")
        ):
            idx["name"] = i
        elif idx["roll"] is None and any(w in k for w in ("roll", "enrol", "regist", "uid")):
            idx["roll"] = i

    def col(i):
        return [r[i].strip() for r in body if i < len(r) and r[i].strip()]

    # no matching header? look at the values instead
    for kind, test in (("email", find_email), ("phone", normalize_phone)):
        if idx[kind] is None:
            for i in range(ncols):
                if i in idx.values():
                    continue
                vals = col(i)
                if vals and sum(1 for v in vals if test(v)) / len(vals) >= 0.5:
                    idx[kind] = i
                    break
    return idx


def parse_students(rows: list[list[str]]) -> dict:
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if not rows:
        raise ValueError("The file is empty")
    first = rows[0]
    has_header = not any(find_email(c) or normalize_phone(c) for c in first)
    ncols = max(len(r) for r in rows)
    header = [h.strip() for h in first] if has_header else [f"Column {i + 1}" for i in range(len(first))]
    body = rows[1:] if has_header else rows
    idx = _detect_columns(header, body, ncols)
    if idx["email"] is None and idx["phone"] is None:
        raise ValueError("Couldn't find an email or phone column in this file")

    def cell(r, k):
        i = idx[k]
        return r[i].strip() if i is not None and i < len(r) else ""

    stats = {"total_rows": len(body), "with_email": 0, "with_phone": 0,
             "invalid_email": 0, "invalid_phone": 0, "duplicates": 0}
    seen_e, seen_p, out = set(), set(), []
    for r in body:
        raw_e, raw_p = cell(r, "email"), cell(r, "phone")
        email = find_email(raw_e) if raw_e else ""
        phone = normalize_phone(raw_p) if raw_p else ""
        if raw_e and not email:
            stats["invalid_email"] += 1
        if raw_p and not phone:
            stats["invalid_phone"] += 1
        if not email and not phone:
            continue
        if (email and email in seen_e) or (phone and phone in seen_p):
            stats["duplicates"] += 1
            continue
        if email:
            seen_e.add(email)
            stats["with_email"] += 1
        if phone:
            seen_p.add(phone)
            stats["with_phone"] += 1
        out.append({"name": cell(r, "name"), "roll": cell(r, "roll"), "email": email, "phone": phone})
    if not out:
        raise ValueError("No valid email addresses or phone numbers found in this file")
    columns = {k: (header[i] if i is not None and i < len(header) else None) for k, i in idx.items()}
    return {"students": out, "columns": columns, "stats": stats}


# ------------------------------------------------------------------ email
def email_config():
    # Reuses the app's existing Gmail settings (same ones mailer.py uses); SMTP_* names still work too.
    user = os.getenv("SMTP_USER") or os.getenv("GMAIL_ADDRESS")
    pw = os.getenv("SMTP_PASSWORD") or os.getenv("GMAIL_APP_PASSWORD")
    if not (user and pw) or os.getenv("MAIL_ENABLED", "true").lower() != "true":
        return None
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": user,
        "password": pw.replace(" ", ""),  # Gmail shows app passwords in groups of 4
        "from": os.getenv("SMTP_FROM") or user,
    }


def smtp_open(cfg):
    ctx = ssl.create_default_context()
    alt = 465 if cfg["port"] != 465 else 587
    last = None
    for port in (cfg["port"], alt):  # try the configured port, then the other Gmail port
        s = None
        try:
            if port == 465:
                s = smtplib.SMTP_SSL(cfg["host"], port, timeout=30, context=ctx)
            else:
                s = smtplib.SMTP(cfg["host"], port, timeout=30)
                s.ehlo()
                s.starttls(context=ctx)
                s.ehlo()
            s.login(cfg["user"], cfg["password"])
            return s
        except smtplib.SMTPAuthenticationError:
            raise RuntimeError(
                "Gmail rejected the login. Use a 16-letter App Password "
                "(Google Account > Security > 2-Step Verification > App passwords), not your normal password."
            )
        except (smtplib.SMTPException, OSError, ssl.SSLError) as e:
            last = e
            try:
                if s:
                    s.close()
            except Exception:
                pass
    raise RuntimeError(
        f"Could not connect to {cfg['host']} on ports {cfg['port']} or {alt}: {last}. "
        "Your network, firewall or antivirus is probably blocking email. Try a mobile hotspot."
    )


# Same ink-navy / brass palette as mailer.py and the app (frontend/src/index.css).
INK_BG, CARD_BG, BORDER = "#0a0d13", "#12161f", "#2a3140"
TEXT, TEXT_MUTED = "#e9ebf1", "#8991a5"
BRASS, BRASS_DARK = "#c6a154", "#a9823a"


def _p(text: str, muted: bool = False, top: int = 0, bottom: int = 12) -> str:
    color = TEXT_MUTED if muted else TEXT
    return f'<p style="margin:{top}px 0 {bottom}px 0;font-family:Arial,sans-serif;font-size:13px;line-height:21px;color:{color};">{text}</p>'


def _credential_box(label: str, value: str) -> str:
    return f"""
                <table role="presentation" width="100%" style="background-color:{INK_BG};border:1px solid {BORDER};border-radius:10px;margin:0 0 4px 0;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:{TEXT_MUTED};">{label}</p>
                      <p style="margin:0;font-family:'JetBrains Mono',Consolas,monospace;font-size:20px;color:{BRASS};letter-spacing:1px;">{value}</p>
                    </td>
                  </tr>
                </table>"""


def _hairline() -> str:
    return f'<div style="height:1px;background-color:{BORDER};margin:22px 0;"></div>'


def _label(text: str) -> str:
    return (f'<p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:11px;font-weight:600;'
            f'letter-spacing:1.5px;text-transform:uppercase;color:{BRASS};">{text}</p>')


def _card(eyebrow: str, title: str, body: str, cta_url: str = "", cta_label: str = "") -> str:
    cta = ""
    if cta_url and cta_label:
        cta = f"""
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px 0;">
                  <tr>
                    <td style="background-color:{BRASS};border-radius:8px;">
                      <a href="{cta_url}" style="display:inline-block;padding:12px 24px;font-family:Arial,sans-serif;font-size:14px;font-weight:600;color:{INK_BG};text-decoration:none;">{cta_label} &rarr;</a>
                    </td>
                  </tr>
                </table>"""
    return f"""\
<html>
  <body style="margin:0;padding:0;background-color:{INK_BG};font-family:Georgia,'Source Serif 4',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{INK_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:{CARD_BG};border:1px solid {BORDER};border-radius:16px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:{BRASS};">{eyebrow}</p>
                <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:600;color:{TEXT};">{title}</h1>
                <div style="width:56px;height:1px;background-color:{BRASS_DARK};margin:14px 0 18px 0;"></div>
                {body}
                {cta}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def build_email(cfg, invite: dict, title: str, note: str, signup_url: str) -> EmailMessage:
    e = html.escape
    name = invite.get("name") or "Student"
    code = invite["code"]
    msg = EmailMessage()
    msg["Subject"] = f"{title}: your exam access code"
    msg["From"] = cfg["from"]
    msg["To"] = invite["email"]

    note_txt = f"\nNote from your teacher: {note}\n" if note else ""
    msg.set_content(
        f"Hello {name},\n\nYou have been invited to take: {title}.\n{note_txt}\n"
        f"Your access code: {code}\n\n"
        f"How to sign up:\n1. Open {signup_url}\n2. Choose \"First time / sign up\"\n"
        "3. Enter this access code, your email and a password, then complete the one-time face enrollment.\n\n"
        "The exam is fully proctored:\n"
        "- You will share your ENTIRE screen and enter fullscreen.\n"
        "- Your webcam stays on and your face is matched to your sign-up photo before the exam starts.\n"
        "- Switching tabs or windows, looking away, copy-paste or leaving fullscreen are flagged; "
        "the 3rd warning ends the exam.\n"
        "- Use your own device and do not share your code or password.\n\n"
        "This code works once and is only for you. Good luck!\n"
    )

    body = _p(f"Hello {e(name)}, you have been invited to take <strong style=\"color:{TEXT};\">{e(title)}</strong>. "
              "Use the access code below to create your account.")
    if note:
        body += _p(e(note), muted=True, bottom=14)
    body += _credential_box("Your access code", e(code))
    body += _p("This code works once and is only for you. Please don't share it.", muted=True, top=12, bottom=0)
    body += _hairline() + _label("How to sign up")
    body += _p(
        f'1. Open the link below<br>2. Choose <strong style="color:{TEXT};">"First time / sign up"</strong><br>'
        "3. Enter your access code, an email and a password<br>4. Complete the one-time face enrollment",
        muted=True, bottom=0,
    )
    body += _hairline() + _label("Before exam day")
    body += _p(
        "The exam is fully proctored. You will share your "
        f'<strong style="color:{TEXT};">entire screen</strong>, enter '
        f'<strong style="color:{TEXT};">fullscreen</strong>, and your webcam must show only you - your face is '
        "matched to your sign-up photo before the paper opens.", muted=True)
    body += _p(
        "Switching tabs or windows, looking away, copy-paste or leaving fullscreen are flagged, and the "
        "3rd warning ends the exam. Use your own device, in a quiet, well-lit spot.", muted=True, bottom=0)

    msg.add_alternative(
        _card("AI Recruiter \u00b7 Exam", "Your exam access code", body, e(signup_url), "Sign up now"),
        subtype="html",
    )
    return msg


# ------------------------------------------------------------------ sms (Twilio)
def sms_config():
    sid, tok, frm = os.getenv("TWILIO_ACCOUNT_SID"), os.getenv("TWILIO_AUTH_TOKEN"), os.getenv("TWILIO_FROM")
    if not (sid and tok and frm):
        return None
    return {"sid": sid, "token": tok, "from": frm}


def build_sms(invite: dict, title: str, signup_url: str) -> str:
    return f"{title}: your exam access code is {invite['code']}. Sign up at {signup_url} (one-time, don't share)."


def send_sms(cfg, to: str, body: str) -> None:
    url = f"https://api.twilio.com/2010-04-01/Accounts/{cfg['sid']}/Messages.json"
    data = urllib.parse.urlencode({"To": to, "From": cfg["from"], "Body": body}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    auth = base64.b64encode(f"{cfg['sid']}:{cfg['token']}".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode(errors="ignore")[:200])


def channel_hint(channel: str) -> str | None:
    """None if the channel is ready, else a message telling HR what to set up."""
    if channel == "email" and not email_config():
        return ("Email isn't set up yet. Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD (and MAIL_ENABLED=true) "
                "in backend/.env and restart the backend.")
    if channel == "phone" and not sms_config():
        return ("SMS isn't set up yet. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM "
                "to backend/.env and restart the backend.")
    return None


def mask_email(e: str) -> str:
    local, _, dom = (e or "").partition("@")
    return f"{local[:1]}***@{dom}" if dom else ""