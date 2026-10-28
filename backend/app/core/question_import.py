"""Turn an uploaded question file (CSV / Excel / plain text) into paper questions.

CSV / Excel: one question per row with a header row. Recognised columns (any order, names are flexible):
  Type | Question | Option A..D (or Options with | between them) | Answer | Marks | Chapter | Topic | Key points
Plain text: questions separated by a blank line, e.g.
  Q1. What is IaaS?
  A) Infrastructure as a Service
  B) Software as a Service
  C) Platform as a Service
  D) None
  Answer: A
  Marks: 1
"""
import csv
import io
import re

MAX_QUESTIONS = 200
MAX_BYTES = 2 * 1024 * 1024
LETTERS = "ABCD"


class ImportError_(ValueError):
    pass


# ------------------------------------------------------------------ reading
def _rows_from_table(filename: str, data: bytes) -> list[list[str]]:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl
        except ImportError:
            raise ImportError_("Excel files need openpyxl on the server. Save the sheet as CSV instead.")
        ws = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True).active
        return [["" if c is None else str(c).strip() for c in row] for row in ws.iter_rows(values_only=True)]
    text = _decode(data)
    try:
        delim = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
    except csv.Error:
        delim = ","
    return [[c.strip() for c in row] for row in csv.reader(io.StringIO(text), delimiter=delim)]


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "ignore")


# ------------------------------------------------------------------ helpers
def _int(v, default):
    m = re.search(r"\d+", str(v or ""))
    return int(m.group(0)) if m else default


def _kind(t: str, has_opts: bool, question: str, marks_given: bool, marks: int) -> str:
    t = (t or "").strip().lower()
    if t in ("mcq", "multiple choice", "multiplechoice", "objective"):
        return "mcq"
    if t in ("fill", "fill in the blanks", "fill-in", "fillup", "fill ups", "blank", "blanks"):
        return "fill"
    if t in ("long", "essay", "descriptive long"):
        return "long"
    if t in ("short", "descriptive", "written", "theory", "question", "subjective"):
        return "short" if marks < 4 else "long"
    if has_opts:
        return "mcq"
    if "___" in question:
        return "fill"
    return "long" if marks >= 4 else "short"


def _finish(i: int, raw: dict, errors: list[str]) -> dict | None:
    """raw: question, type, options(list), answer, marks, chapter, topic, key_points(list)."""
    q = (raw.get("question") or "").strip()
    if not q:
        errors.append(f"Question {i}: the question text is empty")
        return None
    opts = [o.strip() for o in raw.get("options") or [] if o and o.strip()]
    marks_given = str(raw.get("marks") or "").strip() != ""
    marks = _int(raw.get("marks"), 0)
    kind = _kind(raw.get("type"), len(opts) >= 2, q, marks_given, marks or 0)
    if not marks_given or marks <= 0:
        marks = 1 if kind in ("mcq", "fill") else (2 if kind == "short" else 5)
    ans = (raw.get("answer") or "").strip()
    out = {
        "q_no": i, "chapter": _int(raw.get("chapter"), 0) or None, "topic": (raw.get("topic") or "").strip(),
        "type": kind, "question": q, "marks": marks, "reference_answer": "",
        "key_points": [k.strip() for k in raw.get("key_points") or [] if k and k.strip()],
        "sources": [], "options": [], "answer": "",
    }
    if kind == "mcq":
        if len(opts) < 2:
            errors.append(f"Question {i}: a multiple-choice question needs at least 2 options")
            return None
        if len(opts) > 4:
            errors.append(f"Question {i}: at most 4 options are supported (A-D)")
            return None
        letter = ""
        m = re.match(r"^\(?([A-Da-d])\)?[\).:]?$", ans)
        if m:
            letter = m.group(1).upper()
        else:  # answer written as the option text
            for k, o in enumerate(opts):
                if ans and o.strip().lower() == ans.lower():
                    letter = LETTERS[k]
        if not letter or LETTERS.index(letter) >= len(opts):
            errors.append(f"Question {i}: the correct answer must be a letter A-{LETTERS[len(opts) - 1]} (or the option text)")
            return None
        out.update(options=opts, answer=letter)
    elif kind == "fill":
        if not ans:
            errors.append(f"Question {i}: a fill-in-the-blanks question needs its answer")
            return None
        out["answer"] = ans
    else:
        out["reference_answer"] = ans  # optional; filled by AI later if left empty
    return out


# ------------------------------------------------------------------ table
_ALIASES = {
    "question": ("question", "questions", "q", "text", "question text", "prompt"),
    "type": ("type", "question type", "qtype", "kind"),
    "answer": ("answer", "correct", "correct answer", "ans", "correct option", "key", "ideal answer", "model answer"),
    "marks": ("marks", "mark", "score", "points"),
    "chapter": ("chapter", "unit", "chapter no", "ch"),
    "topic": ("topic", "subtopic"),
    "key_points": ("key points", "keypoints", "key_points", "points to cover"),
    "options": ("options", "choices"),
}


def _norm(h: str) -> str:
    return re.sub(r"[^a-z0-9 _]", "", (h or "").lower()).replace("_", " ").strip()


def _from_table(rows: list[list[str]]) -> list[dict]:
    rows = [r for r in rows if any((c or "").strip() for c in r)]
    if len(rows) < 2:
        raise ImportError_("The file needs a header row and at least one question")
    head = [_norm(h) for h in rows[0]]
    col: dict[str, int] = {}
    opt_cols: dict[str, int] = {}
    for idx, h in enumerate(head):
        for key, names in _ALIASES.items():
            if h in names and key not in col:
                col[key] = idx
        m = re.match(r"^(?:option|opt|choice)\s*([a-d1-4])$", h) or re.match(r"^([a-d])$", h)
        if m:
            k = m.group(1).upper()
            k = "ABCD"["1234".index(k)] if k in "1234" else k
            opt_cols[k] = idx
    if "question" not in col:
        raise ImportError_('Could not find a "Question" column. Use the template from the Download template button.')
    out = []
    for r in rows[1:]:
        def cell(key):
            i = col.get(key)
            return r[i].strip() if i is not None and i < len(r) else ""
        opts = [r[opt_cols[k]].strip() for k in "ABCD" if k in opt_cols and opt_cols[k] < len(r)]
        if not any(opts) and cell("options"):
            opts = [o.strip() for o in re.split(r"\s*[|;]\s*|\n", cell("options")) if o.strip()]
        out.append({
            "question": cell("question"), "type": cell("type"), "options": opts, "answer": cell("answer"),
            "marks": cell("marks"), "chapter": cell("chapter"), "topic": cell("topic"),
            "key_points": [k for k in re.split(r"\s*[;|]\s*", cell("key_points")) if k],
        })
    return out


# ------------------------------------------------------------------ plain text
_OPT = re.compile(r"^\s*\(?([A-Da-d])[\).:]\s+(.*\S)\s*$")
_FIELD = re.compile(r"^\s*(answer|ans|correct|marks|type|chapter|topic|key points|keypoints)\s*[:=-]\s*(.*)$", re.I)
_STARTQ = re.compile(r"^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s+", re.I)


def _from_text(text: str) -> list[dict]:
    lines = [ln.rstrip() for ln in text.replace("\r", "").split("\n")]
    blocks, cur = [], []
    for ln in lines:
        if not ln.strip():
            if cur:
                blocks.append(cur)
                cur = []
            continue
        if cur and _STARTQ.match(ln) and any(_FIELD.match(x) for x in cur):
            blocks.append(cur)  # a numbered line right after a finished block starts a new question
            cur = []
        cur.append(ln)
    if cur:
        blocks.append(cur)
    out = []
    for b in blocks:
        q_lines, opts, fields, last = [], [], {}, None
        for ln in b:
            fm = _FIELD.match(ln)
            om = _OPT.match(ln)
            if fm:
                last = fm.group(1).lower().replace("ans", "answer") if fm.group(1).lower() == "ans" else fm.group(1).lower()
                fields[last] = fm.group(2).strip()
            elif om and not fields:
                opts.append(om.group(2).strip())
                last = "opt"
            elif last in ("answer", "key points", "keypoints"):
                fields[last] = (fields[last] + "\n" + ln.strip()).strip()
            elif last == "opt" and opts:
                opts[-1] += " " + ln.strip()
            else:
                q_lines.append(ln.strip())
        qtext = _STARTQ.sub("", " ".join(q_lines), count=1).strip()
        out.append({
            "question": qtext, "type": fields.get("type", ""), "options": opts,
            "answer": fields.get("answer") or fields.get("correct") or "",
            "marks": fields.get("marks", ""), "chapter": fields.get("chapter", ""), "topic": fields.get("topic", ""),
            "key_points": [k for k in re.split(r"\s*[;\n]\s*", fields.get("key points") or fields.get("keypoints") or "") if k],
        })
    return out


# ------------------------------------------------------------------ public
def parse_questions(filename: str, data: bytes) -> list[dict]:
    if len(data) > MAX_BYTES:
        raise ImportError_("File too large (max 2 MB)")
    name = (filename or "").lower()
    if name.endswith((".csv", ".tsv", ".xlsx", ".xlsm")):
        raw = _from_table(_rows_from_table(filename, data))
    elif name.endswith((".txt", ".md", ".text")):
        raw = _from_text(_decode(data))
    else:
        raise ImportError_("Please upload a .csv, .xlsx or .txt file")
    if not raw:
        raise ImportError_("No questions found in the file")
    if len(raw) > MAX_QUESTIONS:
        raise ImportError_(f"Too many questions (max {MAX_QUESTIONS})")
    errors: list[str] = []
    qs = []
    for i, r in enumerate(raw, start=1):
        q = _finish(i, r, errors)
        if q:
            qs.append(q)
    if errors:
        more = f" (+{len(errors) - 5} more)" if len(errors) > 5 else ""
        raise ImportError_("Fix these and upload again: " + "; ".join(errors[:5]) + more)
    for n, q in enumerate(qs, start=1):
        q["q_no"] = n
    return qs
