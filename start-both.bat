@echo off
start "CivicAI Frontend" cmd /k "cd /d C:\Users\USER\CivicAI\civicai-frontend && npm run dev"
start "CivicAI Backend" cmd /k "cd /d C:\Users\USER\CivicAI\civicai-backend && call venv\Scripts\activate && uvicorn main:app --reload --port 8000"