@echo off
REM One-click launcher for AI Recruiter (backend + frontend)
echo Starting backend (FastAPI)...
start "AI Recruiter - Backend" cmd /k "cd /d %~dp0backend && venv\Scripts\activate && uvicorn app.main:app --reload --port 8000"

echo Starting frontend (Vite)...
start "AI Recruiter - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both servers are starting in separate windows.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
pause
