# Publicação sem Lovable

Este pacote pode ser hospedado como uma aplicação Node/Express + PostgreSQL. O HTML e a API são entregues pelo mesmo servidor, evitando o erro `Failed to fetch` causado por abrir o HTML com `file:///` ou publicar apenas a parte visual.

## Render + PostgreSQL

1. Crie um banco PostgreSQL no provedor escolhido.
2. Suba este projeto para um repositório GitHub.
3. No Render, crie um Web Service apontando para o repositório.
4. O `render.yaml` já define build/start/health check.
5. Configure `DATABASE_URL` com a URL do PostgreSQL.
6. O `JWT_SECRET` pode ser gerado pelo próprio Render conforme o `render.yaml`.
7. Faça o deploy.
8. Teste `https://SEU-ENDERECO/api/health` e confirme `ok: true` e `database: true`.
9. Abra o endereço principal. Não use `file:///`.

## Persistência

A última Base Geral e o Pagamentos SIAFE ficam no PostgreSQL. Usuários também ficam no PostgreSQL. Assim, computadores diferentes acessam a mesma informação compartilhada.

## Primeiro acesso

Se o banco estiver vazio, o primeiro login válido cria a conta como Master.
