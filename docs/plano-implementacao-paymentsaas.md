# Plano de Implementação - paymentSaas

## Contexto

Este documento transforma a proposta em um plano executável para o `paymentSaas`, com ordem de implementação, critérios de aceite, rollout e rollback.

Baseado em:

1. `docs/proposta-sse-realtime.md`
2. Estado atual validado no `paymentSaas`

## Estado atual validado (ponto de partida)

1. O fluxo principal ainda cria envelope de forma síncrona no checkout.
2. A página de sucesso ainda depende de polling com fallback para API da Clicksign.
3. Existem múltiplos usos de `localStorage` para dados sensíveis.
4. O webhook Hotmart existe, porém o frontend mantém múltiplos fallbacks de detecção.
5. `CLICKSIGN_SEND_NOTIFICATION=true` no `.env`, mas no código o envio de notificação está desativado nos fluxos principais.
6. O requirement `provide_evidence` com `auth: email` está ativo e deve ser mantido.

## Objetivo final (produção)

1. Checkout assíncrono via fila (QStash + worker idempotente).
2. Banco como fonte única de verdade (`orderId` como chave entre páginas).
3. Polling apenas no DB (`/sucesso` e `/payment`), sem polling na API da Clicksign.
4. Remoção de `localStorage` para dados sensíveis no novo fluxo.
5. Rollout gradual com feature flag e rollback imediato.

## Princípios de migração

1. Zero ruptura de produção: coexistência temporária de fluxo novo e legado.
2. Compatibilidade primeiro, remoção depois.
3. Cada etapa com métricas e critério de avanço.
4. Priorizar confiabilidade sobre velocidade no início do rollout.

## Plano por fases

## Fase 0 - Preparação de base

Objetivo: habilitar o novo fluxo sem alterar comportamento atual para todos os usuários.

Entregas:

1. Adicionar feature flag por `productId`/`offerId` para o fluxo novo.
2. Criar configuração de fila e limites por ambiente (sandbox e produção).
3. Padronizar modelo de status do pedido: `pending`, `envelope_created`, `signed`, `paid`.
4. Definir logs estruturados mínimos (`orderId`, `event`, `duration_ms`, `status_before`, `status_after`).

Critério de pronto:

1. Nenhuma rota existente alterada para usuários sem flag.
2. Logs e métricas disponíveis para acompanhar worker e webhooks.

## Fase 1 - Contratos novos (API + estado)

Objetivo: criar o backbone do fluxo novo com `orderId`.

Entregas:

1. `POST /api/checkout`:
2. Validar dados.
3. Criar pedido `pending`.
4. Enfileirar job com `{ orderId }`.
5. Responder `{ orderId }`.
6. `GET /api/order/[orderId]`:
7. Responder estado consolidado para `/sucesso`, `/payment` e `/final-success`.
8. Implementar transições idempotentes no backend.

Critério de pronto:

1. Fluxo novo funcional com mock/simulação sem depender de localStorage.
2. Sem regressão no fluxo legado.

## Fase 2 - Worker QStash idempotente

Objetivo: remover criação síncrona e controlar taxa de chamadas para Clicksign.

Entregas:

1. Worker idempotente por `orderId`.
2. Retry seguro em 429/5xx.
3. Atualização de pedido para `envelope_created` com IDs Clicksign.
4. Configuração inicial conservadora de `flowControl`.
5. Manter `provide_evidence` (`auth: email`) para preservar autenticação por token.
6. Notificação extra por e-mail opcional por feature/env (desligada por padrão no fluxo widget).

Critério de pronto:

1. Worker processa retries sem duplicar envelope.
2. Sem 429 em carga controlada inicial.

## Fase 3 - Página de sucesso sem polling na Clicksign

Objetivo: trocar fallback externo por polling no DB.

Entregas:

1. `/sucesso` do fluxo novo usa só `orderId` + `GET /api/order/[orderId]`.
2. Polling no DB a cada 2s apenas enquanto `pending`.
3. Renderização do widget quando `envelope_created`.
4. Sem chamadas periódicas para `getDocumentStatus` na API Clicksign no frontend.

Critério de pronto:

1. Zero polling na Clicksign API no fluxo novo.
2. Assinatura no widget segue funcionando com `provide_evidence`.

## Fase 4 - Pagamento e finalização orientados por estado

Objetivo: simplificar detecção de pagamento e eliminar heurísticas.

Entregas:

1. `/payment` do fluxo novo recebe `orderId`.
2. Prefill Hotmart vindo do DB.
3. Webhook Hotmart como fonte de verdade para `paid`.
4. Polling no DB a cada 3s até `paid`.
5. `/final-success` consumindo `GET /api/order/[orderId]`.

Critério de pronto:

1. Sem DOM scanning, sem fallback por texto/URL no fluxo novo.
2. Transição para `paid` guiada por webhook + estado no DB.

## Fase 5 - Desacoplamento de localStorage no fluxo novo

Objetivo: remover dependência de armazenamento sensível no browser.

Entregas:

1. Fluxo novo sem leitura/escrita de dados sensíveis em `localStorage`.
2. Dado transitando por `orderId` e API.
3. Compatibilidade temporária apenas no legado enquanto a flag não estiver em 100%.

Critério de pronto:

1. Auditoria de arquivos do fluxo novo sem uso de `localStorage` sensível.

## Fase 6 - Rollout gradual e corte

Objetivo: ligar novo fluxo para todos os produtos elegíveis com segurança.

Sequência:

1. 10% do tráfego elegível.
2. 50% do tráfego elegível.
3. 100% do tráfego elegível.

Critério de avanço por etapa:

1. `workerFailedRate` abaixo de limiar acordado.
2. `429` controlado ou zero.
3. Tempo de fila (`queue lag p95`) dentro do limite de UX definido.
4. Sem aumento relevante de erro no checkout final.

Rollback:

1. Feature flag volta imediatamente para fluxo legado.
2. Sem necessidade de deploy emergencial.

## Estratégia de PRs (ordem sugerida)

1. PR-01: feature flag + contratos base + estado canônico.
2. PR-02: worker QStash idempotente + observabilidade mínima.
3. PR-03: `/sucesso` novo (DB polling) + remoção de polling Clicksign no fluxo novo.
4. PR-04: `/payment` e `/final-success` novos orientados por `orderId`.
5. PR-05: remoção de `localStorage` no fluxo novo.
6. PR-06: rollout progressivo + ajustes de taxa.
7. PR-07: remoção de legado após estabilização.

## Testes obrigatórios por fase

## Testes funcionais

1. `pending -> envelope_created -> signed -> paid` ponta a ponta.
2. Reprocessamento idempotente de worker e webhooks.
3. Compatibilidade entre fluxo novo (flag on) e legado (flag off).

## Testes de carga

1. Sandbox: 20, 30 e 50 checkouts.
2. Coletar: `429`, `failed`, `queue lag avg/p95`, `worker duration p95`, `end-to-end p95`.
3. Ajustar `flowRate`/`flowParallelism` por ambiente até atingir equilíbrio.

## Testes de segurança

1. HMAC obrigatório em webhooks de produção.
2. Requisição inválida retorna `401`.
3. Verificação de replay/timestamp quando disponível.

## Matriz inicial de configuração (sugerida)

Sandbox:

1. Começar conservador (`rate` baixo) e subir gradualmente.
2. Meta: zero 429 com latência aceitável para testes.

Produção:

1. Iniciar abaixo do teto teórico e subir por rollout.
2. Meta: throughput melhor sem ultrapassar limites da Clicksign.

Observação:

1. O requirement `provide_evidence` deve permanecer ativo no fluxo widget para manter autenticação por token de e-mail.
2. Envio de notificação adicional de envelope deve ser controlado por config, pois impacta requests por envelope.

## Critérios finais de aceite para corte do legado

1. Fluxo novo em 100% dos produtos elegíveis por janela mínima de estabilidade acordada.
2. Sem polling na Clicksign API no frontend.
3. Sem `localStorage` sensível no fluxo novo.
4. Sem regressão de conversão e sem aumento relevante de erro operacional.
5. Playbook de rollback validado em ambiente de preview/staging.

## Referências de código (estado atual)

1. `src/lib/clicksign-service.ts`
2. `src/actions/checkout/index.ts`
3. `src/actions/checkout/create-document.ts`
4. `src/app/sucesso/components/success-content.tsx`
5. `src/app/payment/components/payment-content.tsx`
