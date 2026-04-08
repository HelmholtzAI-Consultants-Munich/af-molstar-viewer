.PHONY: help install install-frontend install-backend dev dev-frontend dev-backend build build-frontend test test-frontend test-backend

FRONTEND_DIR := frontend
BACKEND_DIR := backend

help:
	@printf "Available targets:\n"
	@printf "  make install           Install frontend and backend dependencies\n"
	@printf "  make install-frontend  Install frontend dependencies\n"
	@printf "  make install-backend   Install backend dependencies with uv\n"
	@printf "  make dev-frontend      Run the Vite dev server\n"
	@printf "  make dev-backend       Run the FastAPI placeholder backend\n"
	@printf "  make build             Build the frontend\n"
	@printf "  make test              Run frontend and backend tests\n"
	@printf "  make test-frontend     Run frontend tests\n"
	@printf "  make test-backend      Run backend tests\n"

install: install-frontend install-backend

install-frontend:
	cd $(FRONTEND_DIR) && npm install

install-backend:
	cd $(BACKEND_DIR) && uv sync

dev: help

dev-frontend:
	cd $(FRONTEND_DIR) && npm run dev

dev-backend:
	cd $(BACKEND_DIR) && uv run backend

build: build-frontend

build-frontend:
	cd $(FRONTEND_DIR) && npm run build

test: test-frontend test-backend

test-frontend:
	cd $(FRONTEND_DIR) && npm test

test-backend:
	cd $(BACKEND_DIR) && PYTHONPATH=src python3 -m unittest discover -s tests
