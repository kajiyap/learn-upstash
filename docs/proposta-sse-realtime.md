# Proposta final: Redesenho do fluxo de checkout

## Análise do código atual (paymentSaas)

### Fluxo atual do aluno

```
1. Preenche formulário
2. Loading modal (5 etapas síncronas — ~6 requests à Clicksign)
3. Redireciona para /sucesso?envelopeId=...&documentId=...&signerId=...
4. Widget Clicksign embedado (assina na página)
5. Polling a cada 3s: DB → se não achou, Clicksign API → 429
6. Webhook Clicksign → atualiza DB (redundante com o polling)
7. Botão "Ir para Pagamento" → /payment
8. Hotmart widget
9. 5 métodos de detecção de pagamento (API, URL, localStorage, DOM, texto)
10. Redireciona para /final-success
```

### Problemas identificados

#### 1. Polling na Clicksign API (causa do 429)

**Arquivo:** `/Users/lucas/repos/projects/paymentSaas/src/app/sucesso/components/success-content.tsx`

```ts
// A cada 3s, para CADA aluno na página
const interval = setInterval(checkDocumentStatus, 3000);
```

`getDocumentStatus()` checa o DB primeiro, mas se não encontra `signed`, chama a Clicksign API. Com 300 alunos = ~100 requests/s à Clicksign. Desnecessário porque:
- O widget embedado JÁ emite evento "signed"
- O webhook JÁ atualiza o DB

#### 2. Criação síncrona de envelopes (causa do 429 em pico)

**Arquivo:** `/Users/lucas/repos/projects/paymentSaas/src/lib/checkout-with-progress.ts`

Cada formulário faz ~6 chamadas síncronas à Clicksign. 300 formulários simultâneos = ~1800 requests. Sem controle de taxa.

#### 3. localStorage com dados sensíveis

**Arquivos que usam localStorage (9 arquivos):**
- `/Users/lucas/repos/projects/paymentSaas/src/app/[productId]/[offerId]/components/dynamic-checkout-form.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/components/checkout-form.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/payment/components/payment-content.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/payment/page.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/checkout/components/checkout-content.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/components/lead-tracking-wrapper.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/sucesso/page.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/app/final-success/page.tsx`
- `/Users/lucas/repos/projects/paymentSaas/src/hooks/use-hotmart-checkout.ts`

O que está sendo armazenado em plain text no browser:
- CPF
- Telefone
- Endereço completo (CEP, rua, número, complemento, bairro, cidade, estado)
- Email, nome

**Por que está assim:** o localStorage funciona como "ponte" entre as páginas (checkout → sucesso → payment → final-success). Cada redirect perde o state do React, então salvam tudo no localStorage.

**Problema:** qualquer script XSS no mesmo domínio lê todos esses dados. Além disso, o dado já está no banco — o localStorage é uma cópia redundante.

#### 4. Detecção de pagamento frágil

**Arquivo:** `/Users/lucas/repos/projects/paymentSaas/src/app/payment/components/payment-content.tsx`

5 métodos diferentes tentam detectar se o pagamento foi feito:
1. API check via email (DB)
2. URL parameter check
3. localStorage flag `payment_success`
4. DOM element detection
5. Text content scanning ("compra aprovada")

Isso indica que, embora o webhook da Hotmart exista no projeto, ele está subutilizado e contornado por múltiplos fallbacks no frontend.

---

## Decisão: Polling no DB (não SSE + Redis)

### Por que não SSE + Redis?

Avaliamos SSE com Upstash Redis para atualizações real-time. Descartado por custo na Vercel:

**Cenário: 300 alunos, cada um espera ~30s**

| | Polling no DB | SSE + Redis |
|--|--------------|-------------|
| Function invocations | 4.500 | 300 |
| Tempo de execução | ~225s (4500 × 50ms) | ~9.000s (300 × 30s) |
| Queries Neon | 4.500 (SELECT por PK, leve) | 0 |
| Commands Redis | 0 | ~900 |
| Conexões simultâneas | 0 | 300 |
| Custo Vercel | Baixo | ~40x mais tempo de execução |

SSE mantém Edge Functions abertas durante toda a espera do aluno. Polling faz requests curtos (~50ms cada) e fecha. Para a Vercel serverless, polling é significativamente mais barato.

### Por que não EventEmitter do Node.js?

`EventEmitter` funciona dentro de um único processo Node.js. Na Vercel, cada request pode rodar numa instância serverless separada. O `.emit()` do webhook e o `.on()` do SSE não se enxergam entre instâncias.

### Por que não Server Components com Suspense streaming?

Um Server Component poderia aguardar no servidor e fazer stream quando o status muda. Mas mantém a função serverless presa durante toda a espera. Timeout da Vercel: 10s (hobby) ou 60s (pro). Se a fila tiver muita gente, o timeout estoura.

### Por que não revalidatePath?

`revalidatePath` chamado pelo webhook invalida o cache, mas só faz efeito no **próximo request**. O browser do aluno que já está com a página aberta não recebe nada.

### Conclusão

Polling no próprio DB é a abordagem correta para deploy na Vercel. É barato (SELECT por primary key), inofensivo (sem rate limit), e não requer infra adicional. O problema do paymentSaas nunca foi "fazer polling" — foi fazer polling **na API da Clicksign**.

---

## Arquitetura proposta

### Princípio

Cada transição de status é disparada por um **evento** (webhook ou ação do widget). O banco de dados é a fonte de verdade. O `orderId` é o único dado que transita entre páginas (via URL). Polling é usado apenas no próprio DB para a etapa de espera do envelope.

### Novo fluxo

```
1. Aluno preenche formulário
2. POST /api/checkout
   → Valida dados (Zod)
   → Salva no Neon (status: "pending", todos os dados do form)
   → Enfileira no QStash: { orderId }
   → Retorna { orderId }
   → Redirect instantâneo para /sucesso?orderId=123

3. Página de sucesso (/sucesso?orderId=123)
   → GET /api/order/123 → status: "pending" → mostra "Preparando seu contrato..."
   → Polling no DB a cada 2s (SELECT por PK, ~50ms)
   → QStash libera worker → cria envelope na Clicksign → atualiza DB (envelope_created)
   → Webhook Clicksign "add_signer" confirma no DB
   → Polling detecta status "envelope_created" → monta widget Clicksign

4. Aluno assina no widget embedado
   → Widget emite evento "signed" → UI atualiza instantaneamente
   → Webhook Clicksign "sign" → atualiza DB (status: "signed")
   → Webhook dispara próxima etapa (Hotmart)
   → Zero polling nesta etapa

5. Redireciona para /payment?orderId=123
   → GET /api/order/123 → retorna todos os dados do DB
   → Hotmart widget inicializa com dados do banco (email, nome, offerCode)
   → Webhook Hotmart → atualiza DB (status: "paid")
   → Polling no DB a cada 3s detecta "paid" → redirect
   → Zero localStorage, zero DOM scanning

6. Redireciona para /final-success?orderId=123
   → GET /api/order/123 → mostra confirmação
   → Tudo vem do banco
   → Zero localStorage
```

### O que muda vs. código atual

| Antes | Depois |
|-------|--------|
| localStorage passa dados sensíveis entre páginas | `orderId` na URL + dados vêm do DB |
| Criação síncrona na Clicksign (429 em pico) | QStash controla taxa (2 requests/10s) |
| Polling Clicksign API a cada 3s por aluno | Widget "signed" event + webhook (zero polling na Clicksign) |
| 5 métodos de detecção de pagamento | Webhook Hotmart → DB + polling no DB |
| CPF/endereço no localStorage (XSS risk) | Só no banco |
| 9 arquivos usando localStorage | Zero localStorage |

### Onde polling existe (e por que é ok)

| Etapa | Polling em quê | Frequência | Por que é ok |
|-------|---------------|------------|-------------|
| Espera do envelope | Neon (SELECT por PK) | 2s | Query leve (~1ms), sem rate limit |
| Espera do pagamento | Neon (SELECT por PK) | 3s | Idem |

| Etapa | Polling em quê | | Por que NÃO existe |
|-------|---------------|-|-------------------|
| Assinatura | Nada | | Widget emite "signed" + webhook |
| Criação de envelope | Nada na Clicksign | | QStash controla + webhook confirma |

### Detalhamento por etapa

#### Etapa 1→2: Formulário → Enfileirar

```
ANTES:
  Form → createCheckoutWithProgress() → 6 calls síncronas à Clicksign → redirect
  (~4s de loading modal)

DEPOIS:
  Form → POST /api/checkout
    1. Valida (Zod)
    2. Salva no Neon (status: "pending")
    3. Enfileira no QStash: { orderId }
    4. Retorna { orderId }
  → Redirect instantâneo para /sucesso?orderId=123
```

O aluno não espera a Clicksign. O redirect é instantâneo (<500ms).

#### Etapa 3→4: Página de sucesso (esperar envelope)

```
ANTES:
  Já tinha o envelope pronto (criação era síncrona)

DEPOIS:
  /sucesso?orderId=123
    1. Página carrega → GET /api/order/123 → status "pending"
    2. Mostra "Preparando seu contrato..."
    3. setInterval a cada 2s → GET /api/order/123
    4. Worker do QStash cria envelope → DB muda pra "envelope_created"
    5. Polling detecta → monta widget Clicksign com signerId do DB
    6. Limpa o interval
```

Polling no Neon por primary key: ~1ms por query. 300 alunos × 0.5 req/s = 150 queries/s no Neon. Trivial.

#### Etapa 4→5: Assinatura (zero polling)

```
ANTES:
  Widget emite "signed" → UI atualiza
  + Polling a cada 3s → getDocumentStatus() → Clicksign API → 429

DEPOIS:
  Widget emite "signed" → UI atualiza instantaneamente → redirect pro pagamento
  Webhook Clicksign "sign" → DB (backup + trigger Hotmart)
  Zero polling
```

#### Etapa 5→6: Pagamento

```
ANTES:
  localStorage.getItem("checkoutFormData") → prefill Hotmart
  localStorage.getItem("offerData") → offerCode
  5 métodos de detecção (API, URL, localStorage, DOM, texto)

DEPOIS:
  GET /api/order/123 → retorna email, nome, offerCode do banco
  Hotmart inicializa com dados do DB
  Webhook Hotmart → DB (status: "paid")
  Polling no DB a cada 3s até detectar "paid" → redirect
```

#### Etapa 6→7: Confirmação final

```
ANTES:
  localStorage.getItem("productData") → link de volta
  getOrderByClicksign(documentId, envelopeId) → dados do pedido

DEPOIS:
  GET /api/order/123 → tudo vem do banco
  Zero localStorage
```

---

## Resumo das tecnologias

| Tecnologia | Papel | Já existe? |
|-----------|-------|:----------:|
| **QStash** | Controle de taxa na criação de envelopes | Sim (learn-upstash) |
| **Neon (Postgres)** | Fonte de verdade (pedidos, status, dados do aluno) | Sim (paymentSaas) |
| **Drizzle** | ORM para queries | Sim (paymentSaas) |
| **Webhooks Clicksign** | Notificação de assinatura (evento "sign") | Sim (paymentSaas) |
| **Widget Clicksign** | Assinatura embedada + evento "signed" no browser | Sim (paymentSaas) |
| **Webhook Hotmart** | Notificação de pagamento | Sim (paymentSaas, hoje subutilizado no fluxo) |
| **Polling no DB** | Espera do envelope + espera do pagamento | Substituir polling atual |

No **learn-upstash**, nenhuma tecnologia nova é necessária para validar o fluxo.
No **paymentSaas**, QStash + worker ainda precisam ser introduzidos; o restante já existe e precisa ser reorganizado.

---

## Requisitos de blueprint para implementação no paymentSaas

Para esta proposta ser um blueprint executável (não só diretriz), os itens abaixo são obrigatórios:

### 1) Contratos de API finais (fonte única)

1. `POST /api/checkout`
2. Body: dados validados do formulário + `productId`/`offerId`
3. Ação: grava pedido (`status: pending`) + publica job `{ orderId }` no QStash
4. Response: `{ orderId }`
5. `GET /api/order/[orderId]`
6. Response: estado consolidado para renderização (`status`, ids Clicksign, dados para Hotmart e dados de exibição)
7. Toda página (`/sucesso`, `/payment`, `/final-success`) lê esse endpoint; sem leitura de `localStorage`

### 2) Máquina de estados canônica

Status permitidos no pedido:

1. `pending`
2. `envelope_created`
3. `signed`
4. `paid`

Regras:

1. Transições só avançam (nunca retrocedem)
2. Eventos duplicados não podem alterar estado já consolidado
3. Qualquer webhook fora de ordem deve ser ignorado de forma idempotente

### 3) Idempotência e deduplicação (worker e webhooks)

1. Worker deve ser idempotente por `orderId` (retry do QStash não pode criar novo envelope para o mesmo pedido)
2. Webhook Clicksign deve ser idempotente por evento/documento
3. Webhook Hotmart deve ser idempotente por `transactionId`
4. Atualizações de DB devem usar condição por estado atual para evitar corrida entre instâncias

### 4) Correlação de IDs (eliminar lookup por email)

1. `orderId` é o identificador interno entre páginas
2. Clicksign correlaciona por `clicksignEnvelopeId`/`clicksignDocumentId`
3. Hotmart correlaciona por `hotmartTransactionId` (persistido no pedido)
4. Lookup por email pode existir só como fallback temporário de migração, nunca como caminho principal

### 5) Migração incremental sem quebra de produção

Fase A (compatibilidade):

1. Introduzir `orderId` nas novas rotas mantendo suporte legado (`documentId/envelopeId`) por janela temporária
2. Habilitar novo fluxo por feature flag (por `productId`/`offerId`)

Fase B (corte):

1. Remover fallback legado de URL
2. Remover leitura/escrita de `localStorage` no checkout
3. Remover polling em Clicksign API fora do worker

### 6) Segurança de webhooks

1. Assinatura HMAC obrigatória em produção (Clicksign e Hotmart)
2. Requisições sem assinatura válida devem retornar `401`
3. Proteger contra replay com tolerância de clock e validação de timestamp quando disponível

### 7) Observabilidade mínima

1. Logs estruturados com `orderId`, `event`, `status_before`, `status_after`, `duration_ms`
2. Métricas mínimas: jobs enfileirados, jobs processados, retries, falhas 429/5xx, latência do worker
3. Dashboard de saúde da fila para operação em campanha/pico

### 8) Rollout e rollback

1. Ativar novo fluxo gradualmente (ex.: 10% → 50% → 100%)
2. Chave de rollback imediato para voltar ao fluxo legado sem deploy emergencial
3. Critério de avanço de fase baseado em erro, retry e tempo médio de processamento

### 9) Escopo explícito: estudo vs. produção

No learn-upstash (estudo):

1. Pode usar store em memória para validar arquitetura e ritmo de fila
2. Objetivo é provar fluxo e comportamento (não persistência definitiva)

No paymentSaas (produção):

1. Persistência obrigatória em Neon/Drizzle
2. Webhooks e worker idempotentes são requisito de integridade
3. Observabilidade e rollback são obrigatórios para operação real

### 10) Critérios de aceite antes do porte completo

1. Teste de carga com 20-30 alunos no estudo sem 429 da Clicksign fora de cenários extremos
2. Confirmação de transição de estado ponta a ponta: `pending -> envelope_created -> signed -> paid`
3. Zero uso de `localStorage` para dados sensíveis no novo fluxo
4. Zero polling em API da Clicksign no frontend
5. Redirect final guiado por estado no DB, sem heurística DOM/texto

---

## Próximos passos

### No learn-upstash (este projeto)

1. Implementar `POST /api/checkout` e `GET /api/order/[orderId]` para simular contrato final de API
2. Mover criação de pedido para antes do enqueue e propagar só `orderId` entre páginas
3. Implementar polling no estado interno apenas em `/sucesso` e `/payment`
4. Simular 20-30 alunos e validar que QStash controla o ritmo sem explosão de chamadas
5. Validar idempotência de worker/webhook com retries forçados

### No paymentSaas (projeto real)

1. Introduzir feature flag de rollout por `productId`/`offerId`
2. Trocar `createCheckoutWithProgress()` por `POST /api/checkout` + enqueue QStash
3. Criar worker idempotente de criação de envelope e atualizar estado para `envelope_created`
4. Remover `setInterval` + `getDocumentStatus()` da página de sucesso (fim do polling na Clicksign API)
5. Remover os 9 usos de localStorage para dados sensíveis e usar `orderId` + `GET /api/order/[orderId]`
6. Simplificar pagamento: webhook Hotmart como fonte de verdade + polling no DB
7. Remover lógicas duplicadas e fallbacks DOM/texto/URL após estabilização do rollout
