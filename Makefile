# ============================================================================
# Makefile — atalhos para o stack QA local (Fase 3).
# ============================================================================
.PHONY: qa-up qa-down qa-nuke qa-logs qa-seed qa-jwt qa-migrate qa-shell qa-status

qa-up: ## Sobe o stack QA local (Supabase self-hosted)
	@test -f docker/.env || (echo "ERRO: copie docker/.env.example para docker/.env"; exit 1)
	docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
	@echo ""
	@echo "Studio:    http://localhost:54323"
	@echo "API:       http://localhost:8000"
	@echo "Postgres:  localhost:54322 (user=postgres)"

qa-down: ## Para o stack (mantém dados)
	docker compose -f docker/docker-compose.yml --env-file docker/.env down

qa-nuke: ## Para o stack e apaga volumes (RESET TOTAL)
	docker compose -f docker/docker-compose.yml --env-file docker/.env down -v

qa-logs: ## Tail dos logs
	docker compose -f docker/docker-compose.yml --env-file docker/.env logs -f --tail=100

qa-status: ## Status dos containers
	docker compose -f docker/docker-compose.yml --env-file docker/.env ps

qa-jwt: ## Gera ANON_KEY e SERVICE_ROLE_KEY assinados com JWT_SECRET
	bash scripts/qa-mint-jwt.sh

qa-seed: ## Baixa último dump S3 (db-backup-s3) e importa no banco QA
	bash scripts/qa-seed.sh $(DATE)

qa-migrate: ## Reaplica migrations do repo (útil após alterar schema)
	@for f in supabase/migrations/*.sql; do \
	  echo ">> $$f"; \
	  PGPASSWORD=$$(grep '^POSTGRES_PASSWORD=' docker/.env | cut -d= -f2) \
	  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $$f; \
	done

qa-shell: ## psql no banco QA
	PGPASSWORD=$$(grep '^POSTGRES_PASSWORD=' docker/.env | cut -d= -f2) \
	psql -h 127.0.0.1 -p 54322 -U postgres -d postgres

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	awk 'BEGIN{FS=":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
