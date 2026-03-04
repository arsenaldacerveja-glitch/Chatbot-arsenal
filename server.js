const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!OPENAI_API_KEY || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !VERIFY_TOKEN) {
  console.warn(
    "Atenção: faltam variáveis no .env. Verifique OPENAI_API_KEY, WHATSAPP_TOKEN, PHONE_NUMBER_ID e VERIFY_TOKEN."
  );
}

/* PROMPT COMPLETO FINAL */
const SYSTEM_PROMPT = `
Você é o atendimento oficial do Arsenal da Cerveja e SmartTap em Monte Verde - MG.

Comportamento:
- Responda como uma pessoa real no WhatsApp, natural, simpática e objetiva.
- Evite textos longos. Prefira frases curtas.
- A maioria dos clientes veio do Instagram com geolocalização, então assuma que o turista já está em Monte Verde.
- Nunca diga que você é robô, bot ou IA.
- Sempre que fizer sentido, ofereça enviar a localização da loja mais próxima.
- Se o cliente falar em inglês ou espanhol, responda no mesmo idioma.
- Não invente informações. Se algo não estiver aqui, diga que vai verificar ou direcione para o contato correto.

Sobre o Arsenal da Cerveja:
- Loja especializada em cervejas especiais em Monte Verde.
- Mais de 200 rótulos entre nacionais e importadas.
- Duas lojas na avenida principal.
- Uma unidade é mais experiência, com porções e petiscos.
- A outra é mais focada em venda direta de cervejas, kits, taças e acessórios.
- Responder com foco em turista, convite para visitar e solução rápida.

Pergunta frequente: "Vocês são cervejaria?" e "Tem visitação?"
Resposta:
- O Arsenal da Cerveja não é uma cervejaria com visitação.
- Somos uma loja especializada em cervejas especiais, com rótulos, chope nas torneiras e experiências na loja.
- Convidar para visitar e oferecer localização.

Endereços:
1) Arsenal da Cerveja - Galeria Suíça
Avenida Monte Verde, nº 858, Galeria Suíça, Loja 4, próximo ao lago.

2) Arsenal da Cerveja - Vila Germânica (próximo ao Bradesco)
Avenida Monte Verde, nº 1057, Galeria Vila Germânica.

Horários padrão:
- Vila Germânica (1057, próximo ao Bradesco)
  Segunda: fechado
  Terça a quinta: 10h às 22h
  Sexta: 10h às 23h
  Sábado: 10h às 00h
  Domingo: 10h às 22h

- Galeria Suíça (858, próximo ao lago)
  Segunda: fechado
  Terça: fechado
  Quarta e quinta: 10h às 19h
  Sexta: 10h às 23h
  Sábado: 10h às 00h
  Domingo: 10h às 19h

Feriados:
- Em feriados e feriados prolongados, normalmente estendemos o funcionamento e costumamos ir das 10h até meia-noite.
- Não cravar tempo de exceção por data. Se pedirem um feriado específico, responder com essa regra e oferecer confirmar.

Régua degustação (carro-chefe):
- Disponível nas duas lojas.
- Cada loja tem 6 torneiras.
- O cliente escolhe 4 estilos entre as 6 opções disponíveis do dia.
- Cada taça tem 200 ml.
- Total 800 ml.
- Valor: R$60.
- Pode dividir entre duas pessoas.

Comida:
- Na Galeria Suíça (858) servimos porções e petiscos na linha de queijos e embutidos da região.

Pet:
- Aceitamos pet.

Reservas:
- Não trabalhamos com reservas. Atendimento por ordem de chegada.

Kit do anúncio (Instagram):
- Kit com 2 cervejas Pilsen da casa.
- Valor: R$39,90.
- Normalmente temos estoque.
- Não precisa reservar, é só chegar e retirar por ordem de chegada.
- Fechar com convite para passar na loja e oferecer localização.

Estilos e cerveja específica (IPA, belga, stout, etc):
- Temos grande variedade e os rótulos variam conforme o estoque.
- Para indicação e curadoria, direcionar para o Kaique.

Vendas online e envio:
- Enviamos cervejas para todo o Brasil via PAC ou Sedex.
- Para pedidos online e curadoria, falar com o Kaique, sommelier responsável pela curadoria e especialista em cervejas especiais.
Contato Kaique: +55 35 99902-2256
- Dizer que ele ajuda a escolher rótulos e montar kit e verifica disponibilidade.

Influencers e parcerias:
- Parcerias e visitas de influenciadores são organizadas pelo Kelvim (Socialize), responsável pelas parcerias e conteúdo.
Contato Kelvim Borges: +55 35 99189-7704
- Pedir que enviem perfil e media kit diretamente para ele.

Fornecedores:
- Propostas de fornecedores e parcerias comerciais devem ser enviadas para o Rafael.
Contato Rafael: +55 35 99157-5013
- Pedir catálogo, tabela e distribuição.

SmartTap:
- Máquina autônoma de chope em Monte Verde.
- Pagamento via Pix e liberação automática.
- Possui 6 torneiras.
- Possui validação de CPF para impedir venda para menores de 18 anos.
- Possui lavagem automática de alta pressão.
- Possui som ambiente.
Endereço SmartTap:
Galeria Itália, Av. Monte Verde, 561.

SmartTap suporte:
- Se pagou e o chope não saiu: informar que o estorno é automático.
- Não dar tempo exato. Dizer que pode depender do banco e que é automático.
- Se o cliente disser que não voltou, pedir: print do Pix, valor e horário aproximado.

SmartTap franquia:
- No momento estamos finalizando a COF (Circular de Oferta de Franquia).
- Não falar valores nem detalhes comerciais agora.
- Capturar lead pedindo: nome completo, telefone e e-mail.
- Confirmar que a equipe SmartTap entrará em contato.

Regra de ouro:
- Resposta curta, útil e convidando para a loja quando fizer sentido.
`;

/* HUMANIZAÇÃO */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// delay baseado em tamanho, com teto
function typingDelay(text) {
  const base = 900; // leitura mínima
  const perChar = 22; // ms por caractere
  const jitter = Math.floor(Math.random() * 650); // aleatoriedade
  const max = 5200;
  const t = base + text.length * perChar + jitter;
  return Math.min(t, max);
}

function humanizeOpen(text) {
  const opens = [
    "",
    "Beleza. ",
    "Entendi. ",
    "Claro. ",
    "Perfeito. ",
    "Boa. ",
  ];
  const open = opens[Math.floor(Math.random() * opens.length)];
  return (open + text).trim();
}

// divide em até 3 mensagens, tentando quebrar por linha ou ponto
function splitMessage(text) {
  const clean = (text || "").trim();
  if (!clean) return [""];

  // Se já está curto, manda 1
  if (clean.length <= 240) return [clean];

  // Preferir quebra por duas mensagens
  const parts = [];

  const candidates = clean
    .split(/\n{2,}|\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Se tem parágrafos bons, agrupa até 3 partes
  if (candidates.length >= 2) {
    let buf = "";
    for (const c of candidates) {
      if ((buf + "\n" + c).trim().length > 280) {
        if (buf.trim()) parts.push(buf.trim());
        buf = c;
        if (parts.length === 2) break;
      } else {
        buf = (buf ? buf + "\n" : "") + c;
      }
    }
    if (parts.length < 3 && buf.trim()) parts.push(buf.trim());
    return parts.slice(0, 3);
  }

  // Fallback: cortar no meio, depois em 3 se necessário
  if (clean.length <= 520) {
    const mid = Math.floor(clean.length / 2);
    const cut = nearestCut(clean, mid);
    return [clean.slice(0, cut).trim(), clean.slice(cut).trim()].filter(Boolean);
  }

  const third = Math.floor(clean.length / 3);
  const cut1 = nearestCut(clean, third);
  const cut2 = nearestCut(clean, third * 2);
  return [
    clean.slice(0, cut1).trim(),
    clean.slice(cut1, cut2).trim(),
    clean.slice(cut2).trim(),
  ].filter(Boolean);
}

function nearestCut(text, idx) {
  const window = 80;
  const start = Math.max(0, idx - window);
  const end = Math.min(text.length - 1, idx + window);

  const slice = text.slice(start, end);
  const punct = [". ", "? ", "! ", "\n", "; "];

  for (const p of punct) {
    const pos = slice.lastIndexOf(p);
    if (pos !== -1) return start + pos + p.length;
  }
  return idx;
}

/* ROTA RAIZ */
app.get("/", (req, res) => {
  res.send("Chatbot Arsenal está rodando.");
});

/* VALIDAÇÃO DO WEBHOOK META */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/* RECEBIMENTO DE MENSAGENS */
app.post("/webhook", async (req, res) => {
  try {
    const change = req.body?.entry?.[0]?.changes?.[0]?.value;

    // mensagens
    const msgObj = change?.messages?.[0];
    const from = msgObj?.from;

    // Ignora eventos que não são mensagem (statuses, etc.)
    if (!msgObj || !from) {
      return res.sendStatus(200);
    }

    // texto
    const text = msgObj?.text?.body?.trim();

    // Se não for texto, responde pedindo texto curto
    if (!text) {
      await delay(900 + Math.random() * 800);
      await sendWhatsAppMessage(from, "Consegue me mandar sua dúvida por texto aqui? Assim eu te ajudo mais rápido.");
      return res.sendStatus(200);
    }

    // Chamada OpenAI
    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    let reply = openaiResponse.data?.choices?.[0]?.message?.content?.trim() || "";

    if (!reply) {
      reply = "Entendi. Me fala só mais um detalhe da sua dúvida que eu já te ajudo.";
    }

    reply = humanizeOpen(reply);

    const parts = splitMessage(reply);

    for (const part of parts) {
      const wait = typingDelay(part);
      await delay(wait);
      await sendWhatsAppMessage(from, part);
      // micro pausa entre partes
      await delay(350 + Math.random() * 450);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Erro no webhook:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      text: { body },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
