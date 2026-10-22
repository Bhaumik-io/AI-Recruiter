"""
mailer.py
Sends all candidate-facing transactional emails via Gmail SMTP + an App
Password — no OAuth app registration needed, just smtplib + email from
the standard library.

Setup (do this once):
1. On the Gmail account you want to send FROM, turn on 2-Step
   Verification (Google Account -> Security).
2. Google Account -> Security -> App Passwords -> generate one for
   "Mail". Copy the 16-character password it gives you.
3. Set these in backend/.env:
     GMAIL_ADDRESS=your-sending-account@gmail.com
     GMAIL_APP_PASSWORD=the16charapppassword   # NOT your normal Gmail password
     MAIL_ENABLED=true

If GMAIL_ADDRESS/GMAIL_APP_PASSWORD aren't set, MAIL_ENABLED defaults to
false and every send_* function raises MailNotConfigured — callers catch
this and surface it as a normal API error rather than crashing the
request that triggered the email.

Every email shares one HTML "card" template (_email_card_html) styled to
match the app's ink-navy/brass "executive credential" look — see
frontend/src/index.css for the same palette. Keep the two in sync if you
change the site's colors.
"""

import base64
import json
import os
import smtplib
import urllib.error
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")
# HTTPS mail (Mailjet): works on hosts that block SMTP, e.g. Render's free tier.
# Set MAILJET_API_KEY + MAILJET_SECRET_KEY and the sender (SMTP_FROM, or GMAIL_ADDRESS) in the environment.
MAILJET_API_KEY = os.getenv("MAILJET_API_KEY", "")
MAILJET_SECRET_KEY = os.getenv("MAILJET_SECRET_KEY", "")
MAIL_FROM = os.getenv("SMTP_FROM") or GMAIL_ADDRESS
USE_MAILJET = bool(MAILJET_API_KEY and MAILJET_SECRET_KEY and MAIL_FROM)
_MAIL_ON = os.getenv("MAIL_ENABLED", "true").lower() == "true"
MAIL_ENABLED = _MAIL_ON and (USE_MAILJET or (bool(GMAIL_ADDRESS) and bool(GMAIL_APP_PASSWORD)))

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587  # STARTTLS

# Same palette as frontend/src/index.css's @theme remap.
INK_BG = "#0a0d13"
CARD_BG = "#12161f"
BORDER = "#2a3140"
TEXT = "#e9ebf1"
TEXT_MUTED = "#8991a5"
BRASS = "#c6a154"
BRASS_DARK = "#a9823a"


class MailNotConfigured(Exception):
    pass


class MailSendError(Exception):
    pass


def _frontend_origin() -> str:
    return os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").rstrip("/")


def _candidate_portal_url() -> str:
    return _frontend_origin() + "/candidate/login"


def _email_card_html(eyebrow: str, title: str, body_blocks: str, cta_url: str = "", cta_label: str = "") -> str:
    """One shared card layout — eyebrow label, serif-ish heading, hairline
    rule, arbitrary HTML body_blocks, and an optional brass CTA button."""
    cta_html = ""
    if cta_url and cta_label:
        cta_html = f"""
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px 0;">
                  <tr>
                    <td style="background-color:{BRASS};border-radius:8px;">
                      <a href="{cta_url}" style="display:inline-block;padding:12px 24px;font-family:Arial,sans-serif;font-size:14px;font-weight:600;color:{INK_BG};text-decoration:none;">
                        {cta_label} &rarr;
                      </a>
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
                <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:{BRASS};">
                  {eyebrow}
                </p>
                <h1 style="margin:0 0 4px 0;font-size:24px;font-weight:600;color:{TEXT};">
                  {title}
                </h1>
                <div style="width:56px;height:1px;background-color:{BRASS_DARK};margin:14px 0 18px 0;"></div>
                {body_blocks}
                {cta_html}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


def _p(text: str, muted: bool = False, top: int = 0, bottom: int = 12) -> str:
    color = TEXT_MUTED if muted else TEXT
    return f'<p style="margin:{top}px 0 {bottom}px 0;font-family:Arial,sans-serif;font-size:13px;line-height:21px;color:{color};">{text}</p>'


def _credential_box(label: str, value: str) -> str:
    return f"""
                <table role="presentation" width="100%" style="background-color:{INK_BG};border:1px solid {BORDER};border-radius:10px;margin:0 0 4px 0;">
                  <tr>
                    <td style="padding:16px 18px;">
                      <p style="margin:0 0 4px 0;font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:{TEXT_MUTED};">
                        {label}
                      </p>
                      <p style="margin:0;font-family:'JetBrains Mono',Consolas,monospace;font-size:18px;color:{BRASS};letter-spacing:0.5px;">
                        {value}
                      </p>
                    </td>
                  </tr>
                </table>"""


def _hairline() -> str:
    return f'<div style="height:1px;background-color:{BORDER};margin:22px 0;"></div>'


def _send_mailjet(to_email: str, subject: str, plain_text: str, html: str):
    payload = {"Messages": [{
        "From": {"Email": MAIL_FROM, "Name": "AI Recruiter"},
        "To": [{"Email": to_email}],
        "Subject": subject,
        "TextPart": plain_text,
        "HTMLPart": html,
    }]}
    token = base64.b64encode(f"{MAILJET_API_KEY}:{MAILJET_SECRET_KEY}".encode()).decode()
    req = urllib.request.Request(
        "https://api.mailjet.com/v3.1/send",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Authorization": "Basic " + token, "content-type": "application/json"},
    )
    try:
        body = urllib.request.urlopen(req, timeout=30).read().decode(errors="ignore")
        status = json.loads(body)["Messages"][0]["Status"]
    except urllib.error.HTTPError as e:
        raise MailSendError(f"Mailjet {e.code}: {e.read().decode(errors='ignore')[:300]}") from e
    except (KeyError, IndexError, ValueError):
        status = "success"  # unexpected reply shape but HTTP 200
    except Exception as e:
        raise MailSendError(f"Mailjet request failed: {e}") from e
    if status != "success":
        raise MailSendError(f"Mailjet rejected the message: {body[:300]}")


def _send(to_email: str, subject: str, plain_text: str, html: str):
    if not MAIL_ENABLED:
        raise MailNotConfigured(
            "Email sending isn't configured — set GMAIL_ADDRESS and "
            "GMAIL_APP_PASSWORD in backend/.env (see mailer.py header for steps)."
        )
    if USE_MAILJET:
        _send_mailjet(to_email, subject, plain_text, html)
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = GMAIL_ADDRESS
    msg["To"] = to_email
    # Plain-text part first, HTML second — clients render the LAST part
    # they understand, so HTML-capable clients show the styled version
    # and plain-text-only clients fall back cleanly.
    msg.attach(MIMEText(plain_text, "plain"))
    msg.attach(MIMEText(html, "html"))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_ADDRESS, [to_email], msg.as_string())
    except Exception as e:
        raise MailSendError(str(e)) from e


# ---------------------------------------------------------------------------
# 1. Shortlist invite — candidate ID + link to sign up
# ---------------------------------------------------------------------------

def send_shortlist_email(to_email: str, candidate_id: str, portal_url: str = ""):
    portal_url = portal_url or _candidate_portal_url()
    plain = (
        "Hi,\n\nGood news — you've been shortlisted for the next stage of the hiring process!\n\n"
        f"Your candidate ID is: {candidate_id}\n\n"
        f"Use this ID to create your account and take your interview:\n{portal_url}\n\n"
        "On the login page, choose \"First time / sign up\", enter this candidate ID "
        "along with an email and password of your choice, then complete the one-time "
        "face enrollment step.\n\n"
        "Before you start the interview, please note it's fully proctored:\n"
        "- You'll be asked to share your ENTIRE screen (not a window/tab) and enter "
        "fullscreen — both are required to begin.\n"
        "- Your webcam stays on for the full interview to confirm you're present and "
        "focused on the screen.\n"
        "- Close other apps, put your phone away, and find a quiet, well-lit spot "
        "before you begin — switching windows, looking away for extended periods, or "
        "ending the screen share will be flagged and can end the interview early.\n\nGood luck!\n"
    )
    body = (
        _p("Good news — you've moved to the next stage of the hiring process. "
           "Use the candidate ID below to set up your account and take your interview.")
        + _credential_box("Candidate ID", candidate_id)
    )
    body += (
        f'<p style="margin:16px 0 0 0;font-family:Arial,sans-serif;font-size:13px;color:{TEXT};">'
        'On the login page, choose <strong>"First time / sign up"</strong>, enter your candidate ID '
        "plus an email and password of your choice, then complete the one-time face enrollment step.</p>"
        + _hairline()
        + f'<p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:{BRASS};">Before you begin</p>'
        + _p('This interview is fully proctored. You\'ll be required to share your '
             f'<strong style="color:{TEXT};">entire screen</strong> and enter '
             f'<strong style="color:{TEXT};">fullscreen</strong> before it starts, and your webcam '
             "stays on throughout to confirm you're present and focused on the screen.", muted=True)
        + _p("Please close other apps, put your phone away, and find a quiet, well-lit spot beforehand — "
             "switching windows, looking away for extended periods, or ending the screen share will be "
             "flagged and can end the interview early.", muted=True, bottom=0)
    )
    html = _email_card_html("AI Recruiter", "You've been shortlisted", body, portal_url, "Set up your account")
    _send(to_email, "You've been shortlisted — here's your candidate ID", plain, html)


# ---------------------------------------------------------------------------
# 2. Selection confirmation — interview passed, video conference scheduled
# ---------------------------------------------------------------------------

def send_selection_confirmation_email(to_email: str, candidate_id: str, scheduled_at_display: str, join_url: str):
    plain = (
        "Hi,\n\nCongratulations — you've been selected to move forward!\n\n"
        f"We'd like to schedule a short video conference to discuss next steps (including salary "
        f"and other details) on:\n{scheduled_at_display}\n\n"
        f"Join at the scheduled time here:\n{join_url}\n\n"
        "Log in with the same candidate ID and face verification you used for your interview — "
        "the meeting will only start once we begin it from our side, so please join a few minutes "
        "early and wait there.\n\nLooking forward to speaking with you!\n"
    )
    body = (
        _p("Congratulations — you've been selected to move forward! We'd like to schedule a short "
           "video conference to discuss next steps, including salary and other details.")
        + _credential_box("Scheduled for", scheduled_at_display)
        + _p("Log in with the same candidate ID and face verification you used for your interview. "
             "The meeting starts once we begin it from our side — please join a few minutes early "
             "and wait there.", muted=True, top=16)
    )
    html = _email_card_html("AI Recruiter", "You've been selected", body, join_url, "Join the conference")
    _send(to_email, "You've been selected — video conference scheduled", plain, html)


# ---------------------------------------------------------------------------
# 3. Conference rescheduled
# ---------------------------------------------------------------------------

def send_conference_rescheduled_email(to_email: str, candidate_id: str, scheduled_at_display: str, join_url: str):
    plain = (
        "Hi,\n\nYour video conference has been rescheduled.\n\n"
        f"New date/time:\n{scheduled_at_display}\n\nJoin at the scheduled time here:\n{join_url}\n\n"
        "Log in with the same candidate ID and face verification as before, and wait — the meeting "
        "starts once we begin it from our side.\n\nSee you then!\n"
    )
    body = (
        _p("Your video conference has been rescheduled. Here's the new date and time:")
        + _credential_box("New date/time", scheduled_at_display)
        + _p("Log in with the same candidate ID and face verification as before, and wait — the "
             "meeting starts once we begin it from our side.", muted=True, top=16)
    )
    html = _email_card_html("AI Recruiter", "Conference rescheduled", body, join_url, "Join the conference")
    _send(to_email, "Your conference has been rescheduled", plain, html)


# ---------------------------------------------------------------------------
# 4. Conference cancelled
# ---------------------------------------------------------------------------

def send_conference_cancelled_email(to_email: str, candidate_id: str, reason: str = ""):
    reason_line_plain = f"\nNote: {reason}\n" if reason else ""
    plain = (
        "Hi,\n\nYour scheduled video conference has been cancelled.\n"
        f"{reason_line_plain}\nWe'll be in touch if we'd like to reschedule.\n\nThank you for your patience.\n"
    )
    body = _p("Your scheduled video conference has been cancelled.")
    if reason:
        body += _p(reason, muted=True)
    body += _p("We'll be in touch if we'd like to reschedule.", muted=True, top=16)
    html = _email_card_html("AI Recruiter", "Conference cancelled", body)
    _send(to_email, "Your conference has been cancelled", plain, html)
