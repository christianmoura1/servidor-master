# Servidor Master — Centro de Comando

Interface web mobile-first para controlar e monitorar uma VPS Windows por meio de uma API de IA.

## Recursos

- Autenticação por e-mail e senha com Supabase Auth.
- Lista de acesso protegida por RLS no banco.
- Chat operacional pronto para integração com a API Python.
- Métricas de CPU, memória, disco e status do Mordomo.
- Atalhos operacionais com confirmação para ações sensíveis.
- Layout responsivo para celular e desktop.

## Executar localmente

Sirva a pasta com qualquer servidor HTTP estático. Por exemplo:

```bash
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Integração com o backend

O ponto central está na função `sendMessage()` em `app.js`. Substitua a resposta simulada por uma chamada autenticada à API Python. A API deve validar o JWT do Supabase antes de executar comandos na VPS.

## Segurança

A chave presente em `config.js` é uma chave publicável do Supabase, apropriada para o navegador. Nunca coloque a chave `service_role` no frontend ou no repositório.

