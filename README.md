# PolyAlpha Monitor — versão séria

Esta versão foi preparada para rodar online com **dados atuais** do Polymarket, sem proxies públicos e sem fallback com dados inventados.

## O que mudou

- remove dados simulados
- remove dependência de proxies CORS públicos
- usa endpoint interno `/api/markets`
- busca mercados ativos diretamente da **Gamma API oficial** do Polymarket
- recarrega automaticamente a cada 30 segundos
- mostra erro quando a API falha, em vez de “inventar” dados
- troca o rótulo incorreto de “spread” por **Gap YES+NO**, que é o que o HTML original realmente calculava

## Estrutura

- `index.html` → interface
- `api/markets.js` → função serverless para buscar os dados oficiais
- `vercel.json` → configuração básica de deploy

## Como publicar no Vercel

1. Crie um projeto no Vercel.
2. Envie esta pasta inteira.
3. O Vercel detectará o `index.html` e a função em `api/markets.js`.
4. Depois do deploy, o front chamará `/api/markets` no mesmo domínio.

## Observação importante

Este painel é um **radar** de mercados. Ele não substitui:

- análise do order book
- slippage real
- fees
- restrições geográficas
- validação de executabilidade

Se quiser transformar isso em uma plataforma ainda mais forte, o próximo passo é adicionar:

- leitura de order book por token via CLOB API
- WebSocket oficial para atualização quase em tempo real
- detalhes por mercado
- histórico de preços
- alertas
