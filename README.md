# Painel de Pesquisa de Convênios — versão compartilhada

Esta versão mantém o layout e as funcionalidades do V44 e acrescenta persistência central para uso por vários usuários em locais diferentes.

## O que foi ajustado

### 1. Bases importadas
- **Todas as Bases**: Celebração, Execução, Fiscalização, Prestação de Contas e PCF Especial.
- **Pagamentos SIAFE**.
- A última importação fica gravada no PostgreSQL e é restaurada quando outro usuário entra no sistema.
- A importação das 5 abas da Base Geral agora é feita em **uma transação**, evitando que uma atualização incompleta deixe as bases misturadas.
- A data/hora da última atualização é armazenada junto com a base.

### 2. Login e usuários
- Usuários são armazenados no PostgreSQL, não no navegador.
- O primeiro acesso, quando não existe nenhum usuário, cria o primeiro **Master**.
- O Master pode criar usuários **Usuário** ou **Master**.
- A criação de usuário usa uma operação central própria e não depende de sincronizar a lista inteira.
- O código de recuperação de senha continua sendo gerado no cadastro.
- "Esqueci minha senha" altera a senha no banco central.
- A sessão usa cookie HttpOnly.
- A sessão válida é reaproveitada no mesmo navegador; cada computador/navegador novo precisa fazer seu próprio login.
- O sistema não usa localStorage/IndexedDB como fonte oficial para usuários ou bases compartilhadas.

## Estrutura

- `backend/public/index.html` — interface do sistema.
- `backend/server.js` — API, autenticação e persistência.
- `backend/schema.sql` — tabelas PostgreSQL.
- `backend/package.json` — dependências.
- `.env.example` — exemplo das variáveis de ambiente.

## Importante

**Não abra o HTML diretamente com `file:///`.** Para que vários usuários compartilhem a mesma atualização, o HTML e a API precisam estar hospedados pelo mesmo servidor/serviço e conectados ao mesmo PostgreSQL.

## Instalação

1. Crie um banco PostgreSQL.
2. Execute `backend/schema.sql` no banco.
3. Configure as variáveis de ambiente com base em `.env.example`.
4. Entre na pasta `backend` e execute:

```bash
npm install
npm start
```

5. O servidor deverá entregar o painel em:

`http://SEU_SERVIDOR:3000`

## Fluxo esperado

1. Master entra no sistema.
2. Importa a Base Geral e/ou o SIAFE.
3. Os dados são gravados no PostgreSQL.
4. Outro usuário, em outro computador/local, faz login.
5. O sistema recupera automaticamente a última versão salva.
6. Uma nova importação substitui a versão anterior daquela base.

## Segurança

- `DATABASE_URL` fica somente no servidor.
- Não coloque a string de conexão PostgreSQL no HTML.
- Altere `JWT_SECRET` antes da publicação.
