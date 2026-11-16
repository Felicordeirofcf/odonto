# Atendimento no WhatsApp: Evolution API no seu VPS

Fluxo: paciente manda mensagem → **Evolution** (no VPS) → avisa o **sistema** (Vercel) → a **IA** responde → Evolution envia.

## 1. Antes de começar
- VPS Linux (Ubuntu 22.04+), 2 GB de RAM ou mais, portas 80 e 443 liberadas.
- Um **subdomínio** apontando para o IP do VPS (registro **A** no DNS), ex.: `whats.suaclinica.com.br`.
- Docker instalado. Se não tiver:

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Subir a Evolution
No VPS, copie esta pasta (`docker-compose.yml` e `.env.example`) para `~/evolution` e rode:

```bash
cd ~/evolution && cp .env.example .env && nano .env
```

Troque tudo que diz **TROQUE** (domínio, senhas). Gere senhas com `openssl rand -hex 32`.

```bash
docker compose up -d
```

Em 1–2 minutos, `https://SEU-SUBDOMINIO/manager` abre o painel da Evolution (entre com a `AUTHENTICATION_API_KEY`).

## 3. Conectar o número da clínica
No painel: **Create instance** → nome (ex.: `clinica`) → canal **Baileys** → **Connect** → leia o QR code no celular da clínica (WhatsApp → Aparelhos conectados).

## 4. Ligar a Evolution ao sistema (webhook)
Troque os 3 valores e rode no VPS (ou em qualquer computador):

```bash
curl -X POST "https://SEU-SUBDOMINIO/webhook/set/clinica" -H "apikey: SUA_AUTHENTICATION_API_KEY" -H "Content-Type: application/json" -d '{"webhook":{"enabled":true,"url":"https://odonto-zeta-pink.vercel.app/api/whatsapp","headers":{"x-webhook-secret":"SEU_SEGREDO_DO_WEBHOOK"},"byEvents":false,"base64":false,"events":["MESSAGES_UPSERT"]}}'
```

## 5. Variáveis na Vercel
| Variável | Valor |
|---|---|
| `EVOLUTION_URL` | `https://SEU-SUBDOMINIO` |
| `EVOLUTION_API_KEY` | a mesma `AUTHENTICATION_API_KEY` |
| `EVOLUTION_INSTANCE` | `clinica` (o nome da instância) |
| `WHATSAPP_WEBHOOK_SECRET` | o mesmo segredo do passo 4 |
| `ANTHROPIC_API_KEY` | chave da API do Claude (console.anthropic.com) |
| `STAFF_WHATSAPP` | número da recepção que recebe avisos, ex.: `5511999999999` |
| `WHATSAPP_AI_MODEL` | opcional. Padrão `claude-opus-5-5`; `claude-haiku-5-5` custa bem menos |
| `WHATSAPP_AI_ENABLED` | opcional. `false` desliga a IA na hora |

Depois: **Redeploy**. Para conferir, entre em `https://odonto-zeta-pink.vercel.app/admin` (senha: variável `ADMIN_PASSWORD`): lá aparece o que está configurado, um botão para testar a conexão do WhatsApp e um simulador para conversar com a IA como se fosse um paciente.

## 6. Informações da clínica
A IA só responde com o que está em `config/atendimento.md`. Preencha esse arquivo antes de ligar.

## Como a IA se comporta
- Responde dúvidas, apresenta a simulação do sorriso e coleta nome, interesse e melhores horários para a recepção confirmar.
- **Passa para a equipe** (avisa no `STAFF_WHATSAPP` e para de responder naquela conversa por 12 h) em casos de dor/urgência, desconto, reclamação, pergunta clínica, áudio/foto, pedido de atendente, ou quando o agendamento está pronto.
- Se alguém da equipe responder pelo WhatsApp da clínica, a IA percebe e fica em silêncio naquela conversa por 12 h.
- Não responde grupos nem status.

## Atenção
- O modo **Baileys** conecta como WhatsApp Web, **não é a API oficial**: o WhatsApp pode bloquear o número, principalmente com envio em massa. Não use para disparos de marketing.
- As mensagens dos pacientes passam pela API do Claude para gerar as respostas: informe isso na política de privacidade da clínica (LGPD).
