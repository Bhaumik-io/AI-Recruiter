"""
resume_parser.py
Extracts raw text from uploaded resume files (PDF).
This is the very first stage of the pipeline: turning a PDF into usable text.

Handles two cases:
1. Text-based PDFs (created digitally) -> extracted directly via pdfplumber
2. Scanned/image-based PDFs (no text layer) -> falls back to OCR
   (pdf2image + pytesseract) to read the text out of the page images
"""

import io
import pdfplumber

try:
    import pytesseract
    from pdf2image import convert_from_bytes
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False

POPPLER_PATH=r"C:\poppler-25.12.0\Library\bin"  # set to the poppler bin folder path if not on PATH
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def extract_text(file) -> str:
    """
    Extract text from a single uploaded PDF file.
    Tries direct text extraction first (fast, works for normal PDFs).
    If that yields nothing, falls back to OCR (for scanned/image PDFs).
    """
    text_chunks = []

    file.seek(0)
    with pdfplumber.open(file) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_chunks.append(page_text)

    full_text = "\n".join(text_chunks)

    if full_text.strip():
        return clean_text(full_text)

    # No text found via direct extraction -> try OCR
    if OCR_AVAILABLE:
        ocr_text = extract_text_via_ocr(file)
        if ocr_text.strip():
            return clean_text(ocr_text)

    return ""  # genuinely no text found even after OCR attempt


def extract_text_via_ocr(file) -> str:
    """
    Converts each PDF page to an image, then runs OCR on it to read the text.
    Used as a fallback for scanned/image-based resumes with no text layer.
    """
    try:
        file.seek(0)
        file_bytes = file.read()

        if POPPLER_PATH:
            images = convert_from_bytes(file_bytes, poppler_path=POPPLER_PATH)
        else:
            images = convert_from_bytes(file_bytes)

        ocr_chunks = []
        for image in images:
            page_text = pytesseract.image_to_string(image)
            if page_text:
                ocr_chunks.append(page_text)

        return "\n".join(ocr_chunks)
    except Exception as e:
        print(f"OCR extraction failed: {e}")
        return ""


def clean_text(text: str) -> str:
    """
    Basic cleanup: remove excessive blank lines/spaces so downstream
    embedding/LLM steps get tidy input.
    """
    lines = [line.strip() for line in text.split("\n")]
    lines = [line for line in lines if line]  # drop empty lines
    return "\n".join(lines)


def extract_all_resumes(uploaded_files) -> dict:
    """
    Takes a list of uploaded files, extracts text from each,
    and assigns a unique candidate_id to every one.

    Returns a dict like:
    {
        "CAND_001": {"filename": "john.pdf", "resume_text": "..."},
        "CAND_002": {"filename": "mary.pdf", "resume_text": "..."},
        ...
    }
    """
    candidates = {}

    for idx, file in enumerate(uploaded_files):
        candidate_id = f"CAND_{idx + 1:03d}"
        try:
            resume_text = extract_text(file)
        except Exception as e:
            resume_text = ""
            print(f"Error parsing {file.name}: {e}")

        candidates[candidate_id] = {
            "filename": file.name,
            "resume_text": resume_text,
        }

    return candidates
