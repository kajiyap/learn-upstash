
# teste-upstash

Projeto de teste integrando QStash (Upstash) com Clicksign via Next.js (App Router).

Este README descreve como configurar, executar e testar localmente usando ngrok para expor a rota pública (necessário para QStash entregar os jobs).

## Requisitos

- Node.js (>=18)
- npm ou pnpm
- ngrok (ou similar) para expor `NEXT_PUBLIC_BASE_URL`
- Conta Upstash QStash com token e signing keys
- Conta Clicksign com token e template

## Instalação

No diretório do projeto:

```bash
npm install
# ou
# pnpm install
```

## Variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto com as variáveis abaixo (exemplo):

```
# QStash (Upstash)
QSTASH_URL="https://qstash-us-east-1.upstash.io"   # opcional
QSTASH_TOKEN="<seu_token_qstash>"
QSTASH_CURRENT_SIGNING_KEY="<sig_...>"
QSTASH_NEXT_SIGNING_KEY="<sig_...>"

# Next public base (será usado pelo enqueue para apontar para seu worker)
# Substitua pelo URL do ngrok ou domínio público
NEXT_PUBLIC_BASE_URL=https://abcd-1234.ngrok-free.app

# Clicksign
CLICKSIGN_TOKEN=<seu_clicksign_token>
CLICKSIGN_BASE_URL=https://sandbox.clicksign.com/api/v3
CLICKSIGN_TEMPLATE_ID=<seu_template_id>
```

Observações:
- `NEXT_PUBLIC_BASE_URL` deve apontar para a URL pública que entrega para sua máquina local (ngrok). Ex.: `https://abcd-1234.ngrok-free.app`.
- `QSTASH_TOKEN` é utilizado pelo `Client` para criar/enfileirar jobs.
- `QSTASH_CURRENT_SIGNING_KEY` e `QSTASH_NEXT_SIGNING_KEY` são usados pelo `Receiver` no worker para validar a assinatura do QStash.

## Executando localmente

1. Abra ngrok para expor a porta onde o Next está rodando (ex.: 3000 ou 8080).

Se quiser rodar Next na porta 8080:

```bash
npx next dev -p 8080
```

Em outra janela:

```bash
ngrok http 8080
```

Copie a URL pública (`https://xxxx.ngrok.io`) e coloque em `NEXT_PUBLIC_BASE_URL` no `.env.local`.

2. Inicie a aplicação Next.js:

```bash
npm run dev
```

Se aparecer `Unable to acquire lock` ou porta já em uso, verifique processos Node.js em execução e finalize o que for necessário.

## Fluxo do sistema

1. O frontend (`/`) permite editar um `checkoutData` (JSON) e escolher `quantity` de jobs.
2. O frontend `POST /api/enqueue` com `{ quantity, checkoutData }`.
3. A rota `app/api/enqueue/route.ts` usa o SDK do QStash para criar/enfileirar N jobs na fila `fila-rate-limit-test` usando `enqueueJSON` com `flowControl`.
4. O QStash entrega cada job para `POST ${NEXT_PUBLIC_BASE_URL}/api/worker` assinando a requisição.
5. `app/api/worker/route.ts` valida a assinatura via `Receiver` e processa o `checkoutData` criando documentos/envelope no Clicksign.
6. Se o worker retornar 500 ou 429, o QStash fará retry automático conforme `retries` configurado.

## Testando

1. Abra a página principal (`/`) via a URL do ngrok.
2. Ajuste `quantity` e `checkoutData` (JSON) e clique para disparar.
3. Verifique logs no terminal do Next.js para ver os requests do worker.

## Segurança

- O worker verifica `upstash-signature` usando `Receiver`. Não desabilite essa verificação em produção.
- Proteja tokens e signing keys. Não os leve ao controle de versão.

## Troubleshooting

- "Port X is in use": encerre outros processos do Next ou escolha outra porta com `-p`.
- "Unable to acquire lock": verifique se há outra instância do `next dev` rodando no mesmo diretório e finalize-a.

## Arquivos principais

- `app/api/enqueue/route.ts` - enfileira jobs no QStash
- `app/api/worker/route.ts` - recebe e processa jobs (valida assinatura)
- `app/page.tsx` - frontend para disparar jobs

---