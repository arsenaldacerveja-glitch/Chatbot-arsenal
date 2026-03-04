const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// ===== ENV =====
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const ARSENAL_SITE_URL = process.env.ARSENAL_SITE_URL || "https://SEU-SITE-AQUI";

// Contatos
const RAFA_PHONE = process.env.RAFA_PHONE || "+5535991574989"; // seu número (fornecedores)
const KAIQUE_PHONE = process.env.KAIQUE_PHONE || "+5535999022256"; // vendas online e curadoria
const KELVIN_PHONE = process.env.KELVIN_PHONE || ""; // influencers (preencher no .env)

// Imagem da régua (Drive direto)
const REGUA_IMAGE_URL =
  process.env.REGUA_IMAGE_URL ||
  "https://drive.google.com/uc?export=view&id=1phCq4KPWOA3z7_xLWqUA50eZtNAKcNYQ";

// ===== Helpers =====
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function humanDelayMs(text) {
  // 650ms a 1650ms + bônus por tamanho (até 1200ms)
  const base = 650 + Math.floor(Math.random() * 1000);
  const extra = Math.min(1200, Math.floor((text?.length || 0) * 10));
  return base + extra;
}

function normalizeText(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function isGreeting(msg) {
  const t = normalizeText(msg);
  return (
    t === "oi" ||
    t === "ola" ||
    t === "bom dia" ||
    t === "boa tarde" ||
    t === "boa noite" ||
    t.startsWith("oi ") ||
    t.startsWith("ola ")
  );
}

// ===== Conversation memory (in-memory) =====
// Para produção: trocar por Redis/DB.
const sessions = new Map();
// Estrutura: { history: [{role, content}], lastActive: Date }
const MAX_TURNS = 12; // 6 user + 6 assistant

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { history: [], lastActive: Date.now() });
  }
  return sessions.get(userId);
}

function pushHistory(userId, role, content) {
  const s = getSession(userId);
  s.history.push({ role, content });
  s.lastActive = Date.now();
  // corta histórico
  if (s.history.length > MAX_TURNS) {
    s.history = s.history.slice(s.history.length - MAX_TURNS);
  }
}

function shouldSendReguaImage(userMessage, assistantText) {
  const t = normalizeText(userMessage);
  const a = normalizeText(assistantText);

  const triggers = [
    "regua",
    "degustacao",
    "degustar",
    "recomendacao",
    "recomenda",
    "primeira vez",
    "o que voces recomendam",
    "carro chefe",
    "experiencia",
    "chopp",
    "chope",
  ];

  const mentioned = triggers.some((k) => t.includes(k) || a.includes(k));
  // Evita mandar imagem em casos técnicos da SmartTap ou fornecedores etc.
  const exclude = ["smarttap", "smart tap", "pix", "estorno", "cpf", "erro", "maquina"];
  const excluded = exclude.some((k) => t.includes(k) || a.includes(k));

  return mentioned && !excluded;
}

// ===== WhatsApp senders =====
async function sendWhatsAppText(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );
}

async function sendWhatsAppImage(to, imageUrl, caption) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption || "",
      },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );
}

// ===== System prompt (tudo que você alimentou) =====
function buildSystemPrompt() {
  return `
Você é o atendimento oficial do Arsenal da Cerveja (Monte Verde) e também recebe demandas da SmartTap no mesmo WhatsApp.
Seu objetivo é ser MUITO humano, simpático, direto, e vender a experiência sem parecer robô.

TOM:
- Conversa natural, frases curtas, sem formalidade exagerada.
- Use poucos emojis (no máximo 1 ou 2 por resposta quando fizer sentido).
- Nunca diga “sou uma IA”. Nunca entregue que é bot.
- Evite respostas longas demais: se o cliente pedir cardápio, você pode resumir e oferecer detalhes.

REGRAS DE CONFIANÇA:
- NÃO invente informação.
- Se faltar dado, faça UMA pergunta curta para destravar.
- Só direcione para o site como ÚLTIMO recurso (quando realmente não der para resolver).
- Não prometa “vou verificar o que está engatado hoje” (as torneiras mudam).
- Não repita “vou enviar localização” se já estiver passando endereço. Passe o endereço e, se possível, um link de mapa.

CONTEXTO DO ARSENAL:
- Arsenal da Cerveja é um empório especializado em cervejas especiais, com mais de 200 rótulos nacionais e importadas.
- Tem duas lojas em Monte Verde:
  1) Galeria Suíça (experiência): serve chopes e também porções de queijos e embutidos da região.
     Endereço: Av Monte Verde, 858, Galeria Suíça, Loja 4 (próximo ao lago).
     Horários: fecha segunda e terça.
       Quarta e quinta: 10h às 19h
       Sexta: 10h às 23h
       Sábado: 10h às 00h
       Domingo: 10h às 19h
  2) Vila Germânica (foco em chope e cervejas): NÃO serve porções. É chope e cervejas para servir.
     Endereço: Av Monte Verde, 1057, Galeria Vila Germânica (próximo ao Bradesco).
     Horários: abre todos os dias.
       Domingo a quinta: 10h às 19h
       Sexta: 10h às 23h
       Sábado: 10h às 00h

CARRO-CHEFE:
- Régua degustação (nas duas lojas):
  Cliente escolhe 4 estilos entre as 6 torneiras, cada taça 200ml.
  Valor: R$60,00. Pode ser dividida entre duas pessoas.
- Quando a pessoa perguntar o que recomenda, primeira vez, degustação, etc, puxe a régua como destaque.

CHOPES:
- Nas lojas, os estilos variam e cada loja pode estar com chopes diferentes.
  Você pode citar exemplos de estilos que costumam aparecer (sem prometer fixo): Pilsen, Witbier, American IPA, New England IPA, Double IPA, Imperial Stout, Fruitbier com maçã verde, Sour, Chopp de vinho.
  Feche incentivando a pessoa a ir até a loja para ver o que está nas torneiras.
- Na SmartTap (fixo): Pilsen, IPA, Dunkel, Cannabis, Chopp de vinho, Gin tônica com frutas amarelas.

PETS:
- Pets são bem-vindos.
- Existe uma cerveja desenvolvida especialmente para pets. Convide para conhecer na loja.

COPOS/TAÇAS/CANECAS:
- Vocês vendem copos, taças e canecas, incluindo personalizados e alguns importados.
- Quando o cliente perguntar disso, frequentemente quer comprar e receber: direcione para o Kaique (contato será inserido).

KITS:
- Existe kit com 2 cervejas (Pilsen da casa e outra opção), por R$39,90.
- Não precisa reservar. Atendimento por ordem de chegada. Incentive a pessoa a ir.

VENDAS ONLINE (ENVIO):
- Arsenal envia para todo o Brasil, mas precisa consultar antes para ver se atende a região e alinhar o envio (PAC/Sedex).
- Quem atende essa curadoria e vendas online é o Kaique, beer sommelier, orienta estilo, temperatura, taça, presente, e recomendações.
- Quando for caso de compra online/cerveja específica/copo/taça, encaminhe para o Kaique.

INFLUENCERS:
- Se pedirem parceria/media kit, encaminhar para Kelvin (contato será inserido). Se não houver contato do Kelvin, peça para enviar o media kit por aqui e diga que o time vai retornar.

FORNECEDORES:
- Direcione para o responsável (Rafa) e informe o contato.

SMARTTAP:
- Pagamento via Pix pode ter atraso (sem citar tempo). Se não liberar chope, o estorno acontece automaticamente.
- A SmartTap tem validação de CPF e bloqueia menor de 18 anos.
- Se perguntarem de franquia: dizer que a COF está em estruturação e pedir nome completo, e-mail e telefone para retorno do time (sem prometer valores).
- Problemas comuns: chope não saiu, espumando, não estornou. Seja calmo, peça 1 ou 2 infos (qual módulo/torneira, horário aproximado, valor, e se apareceu mensagem na tela) e diga que vai orientar.

CARDÁPIO GALERIA SUÍÇA (responder só quando pedirem cardápio/porções):
- Porções principais:
  Tábua de frios R$110 (acompanhamentos: torradas, geleia de morango, mostarda com maracujá, molho agridoce com gengibre)
  Mix de embutidos R$70 (acompanha: torradas, geleia de morango, mostarda com maracujá, molho de cebola e especiarias)
  Mix de queijos R$70 (acompanha: torradas, geleia de morango, mostarda com maracujá, molho de cebola e especiarias)
- Porções individuais:
  Embutidos: Eisbein defumado R$40; Lombo condimentado R$40; Linguiça defumada recheada com provolone R$40; Salame R$30
  Queijos: Brie com geleia de morango R$45; Gouda R$45; Gorgonzola R$45; Parmesão R$45
- Sempre conectar com a régua degustação como carro-chefe.

FORMATO DE SAÍDA:
Responda SEMPRE em JSON válido no seguinte formato:
{
  "reply": "texto final para o cliente",
  "confidence": 0.0 a 1.0,
  "send_regua_image": true/false,
  "handoff": "none" | "kaique" | "rafa" | "kelvin" | "site",
  "one_question": "se precisar perguntar algo, coloque aqui, senão vazio"
}

- Use handoff="site" APENAS como último caso.
- Se one_question não estiver vazio, a reply deve terminar com essa pergunta.
`.trim();
}

// ===== OpenAI call =====
async function askOpenAI(userId, userMessage) {
  const session = getSession(userId);
  const systemPrompt = buildSystemPrompt();

  const messages = [
    { role: "system", content: systemPrompt },
    ...session.history,
    { role: "user", content: userMessage },
  ];

  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    }
  );

  const raw = resp.data?.choices?.[0]?.message?.content || "";
  let parsed = null;

  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  // fallback se vier quebrado
  if (!parsed || typeof parsed.reply !== "string") {
    parsed = {
      reply:
        "Pego! Só me confirma uma coisa pra eu te responder certinho: você quer falar da Galeria Suíça, da Vila Germânica ou da SmartTap?",
      confidence: 0.3,
      send_regua_image: false,
      handoff: "none",
      one_question:
        "Você quer falar da Galeria Suíça, da Vila Germânica ou da SmartTap?",
    };
  }

  return parsed;
}

// ===== Routes =====
app.get("/", (req, res) => {
  res.send("Chatbot Arsenal está rodando.");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;

    const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

    if (!message || !from) return res.sendStatus(200);

    // ignora mensagens que não são texto (opcional)
    // const msgType = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type;
    // if (msgType && msgType !== "text") return res.sendStatus(200);

    // Se for só saudação, dá um menu rápido e humano
    if (isGreeting(message)) {
      const hi =
        "Olá! Bem-vindo ao Arsenal da Cerveja 🍻\n\n" +
        "Este é nosso atendimento oficial para as lojas do Arsenal em Monte Verde e também para a SmartTap.\n\n" +
        "Quer falar sobre:\n" +
        "1) Horários e localização\n" +
        "2) Régua degustação e chopes\n" +
        "3) Cardápio (Galeria Suíça)\n" +
        "4) SmartTap (suporte)\n\n" +
        "Me diz o número ou a sua dúvida 😉";
      await sleep(humanDelayMs(hi));
      await sendWhatsAppText(from, hi);
      return res.sendStatus(200);
    }

    // grava user msg no histórico
    pushHistory(from, "user", message);

    const ai = await askOpenAI(from, message);

    let reply = String(ai.reply || "").trim();
    let confidence = typeof ai.confidence === "number" ? ai.confidence : 0.5;
    const handoff = ai.handoff || "none";

    // Se o modelo quiser perguntar 1 coisa, garante que termina com pergunta
    const oneQuestion = String(ai.one_question || "").trim();
    if (oneQuestion && !reply.endsWith("?")) {
      reply = reply.replace(/\s+$/, "") + "\n\n" + oneQuestion;
    }

    // Handoffs
    if (handoff === "kaique") {
      reply += `\n\nSe quiser, fala direto com o Kaique aqui: ${KAIQUE_PHONE} 🍻`;
    }

    if (handoff === "rafa") {
      reply += `\n\nPara fornecedores, pode falar direto com o responsável por aqui: ${RAFA_PHONE}`;
    }

    if (handoff === "kelvin") {
      if (KELVIN_PHONE) {
        reply += `\n\nParcerias e influenciadores: fala com o Kelvin por aqui: ${KELVIN_PHONE}`;
      } else {
        reply +=
          "\n\nPode me mandar seu media kit por aqui mesmo (link + @ do Instagram) que nosso time de mídia retorna.";
      }
    }

    // Site como último caso
    if (handoff === "site" || confidence < 0.35) {
      // Só usa site se realmente necessário
      if (!reply.includes(ARSENAL_SITE_URL)) {
        reply += `\n\nSe preferir, você também pode confirmar no nosso site: ${ARSENAL_SITE_URL}`;
      }
    }

    // Delay humano
    await sleep(humanDelayMs(reply));

    // envia texto
    await sendWhatsAppText(from, reply);

    // manda imagem da régua se fizer sentido
    const wantReguaImage =
      Boolean(ai.send_regua_image) || shouldSendReguaImage(message, reply);

    if (wantReguaImage) {
      // pequena pausa pra parecer humano
      await sleep(500 + Math.floor(Math.random() * 700));
      await sendWhatsAppImage(
        from,
        REGUA_IMAGE_URL,
        "🍻 Régua degustação do Arsenal. Você escolhe 4 estilos, 200ml cada taça."
      );
    }

    // grava assistant reply no histórico
    pushHistory(from, "assistant", reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    return res.sendStatus(200); // evita que Meta re-tente e duplique mensagens
  }
});

// ===== Start =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
