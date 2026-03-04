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
  console.warn("⚠️ Variáveis .env faltando. Confira OPENAI_API_KEY, WHATSAPP_TOKEN, PHONE_NUMBER_ID, VERIFY_TOKEN");
}

/* -----------------------------
   DADOS DO NEGÓCIO (fonte única)
-------------------------------- */
const BUSINESS = {
  arsenal: {
    name: "Arsenal da Cerveja",
    city: "Monte Verde - MG",
    description:
      "Loja especializada em cervejas especiais, com mais de 200 rótulos entre nacionais e importadas. Duas lojas em Monte Verde: uma mais focada em experiência com porções e outra mais focada em loja e kits.",
    stores: {
      galeriaSuica: {
        label: "Arsenal da Cerveja - Galeria Suíça",
        address: "Avenida Monte Verde, 858, Galeria Suíça, Loja 4 (próximo ao lago)",
        mapsLink:
          "https://www.google.com/maps/search/?api=1&query=Avenida%20Monte%20Verde%2C%20858%2C%20Monte%20Verde%20MG%20Galeria%20Su%C3%AD%C3%A7a%20Loja%204",
        hours: [
          { day: "Segunda", hours: "Fechado" },
          { day: "Terça", hours: "Fechado" },
          { day: "Quarta", hours: "10h às 19h" },
          { day: "Quinta", hours: "10h às 19h" },
          { day: "Sexta", hours: "10h às 23h" },
          { day: "Sábado", hours: "10h às 00h" },
          { day: "Domingo", hours: "10h às 19h" },
        ],
      },
      vilaGermanica: {
        label: "Arsenal Store - Galeria Vila Germânica",
        address: "Avenida Monte Verde, 1057, Galeria Vila Germânica (próximo ao Bradesco)",
        mapsLink:
          "https://www.google.com/maps/search/?api=1&query=Avenida%20Monte%20Verde%2C%201057%2C%20Monte%20Verde%20MG%20Galeria%20Vila%20Germ%C3%A2nica%20Bradesco",
        hours: [
          { day: "Domingo a Quinta", hours: "10h às 19h" },
          { day: "Sexta", hours: "10h às 23h" },
          { day: "Sábado", hours: "10h às 00h" },
        ],
      },
    },
    tasting: {
      name: "Régua Degustação",
      howItWorks:
        "Você escolhe 4 estilos entre 6 opções de chope. Cada taça tem 200ml (total 800ml).",
      price: "R$60",
      note: "Dá para dividir em casal.",
    },
    kitInstagram: {
      name: "Kit especial do anúncio",
      description:
        "Kit com 2 cervejas artesanais da casa (Pilsen), por R$39,90.",
      price: "R$39,90",
      reservationPolicy:
        "Normalmente não precisa reservar, é só chegar e pegar. Atendemos por ordem de chegada.",
    },
    policies: {
      reservations: "Não trabalhamos com reservas. Atendimento por ordem de chegada.",
      pet: "Sim, aceitamos pets.",
    },
    onlineSales: {
      enabled: true,
      personName: "Kaique",
      role: "sommelier responsável pela curadoria",
      phone: "+55 35 99902-2256",
      shipping: "Envio via PAC ou Sedex para todo o Brasil.",
    },
    influencers: {
      personName: "Kelvin",
      role: "equipe Socialize (parcerias e influencers)",
      phone: "+55 35 99189-7704",
    },
  },

  smartTap: {
    name: "SmartTap",
    description:
      "Máquina autônoma de chope. Pagamento via Pix e liberação automática. Possui validação de CPF que bloqueia tentativas de compra por menor de 18 anos. Também conta com sistema de lavagem automática de alta pressão.",
    commonIssues: [
      "chope não saiu",
      "chope espumando",
      "pix pago e não liberou",
      "estorno não apareceu ainda",
    ],
    franchise: {
      status:
        "Estamos estruturando a COF (Circular de Oferta de Franquia).",
      leadFields:
        "Para receber informações quando estiver liberado: nome completo, telefone e e-mail.",
    },
  },
};

/* -----------------------------
   MEMÓRIA / CONTEXTO POR USUÁRIO
-------------------------------- */
const sessions = new Map(); // from -> session
const processedMessages = new Set(); // message.id dedupe (memória curta)

const SESSION_TTL_MS = 1000 * 60 * 30; // 30 min
const MAX_HISTORY = 12;

function now() {
  return Date.now();
}

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getSession(from) {
  const s = sessions.get(from);
  if (!s) {
    const fresh = {
      lastSeen: now(),
      state: { lastTopic: null, lastStore: null, waiting: null },
      history: [],
    };
    sessions.set(from, fresh);
    return fresh;
  }
  s.lastSeen = now();
  return s;
}

function cleanupSessions() {
  const t = now();
  for (const [k, v] of sessions.entries()) {
    if (t - v.lastSeen > SESSION_TTL_MS) sessions.delete(k);
  }
  // processedMessages pode crescer. Limpeza simples:
  if (processedMessages.size > 5000) processedMessages.clear();
}

setInterval(cleanupSessions, 60 * 1000);

function pushHistory(session, role, content) {
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(session.history.length - MAX_HISTORY);
  }
}

/* -----------------------------
   WHATSAPP SEND
-------------------------------- */
async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWhatsAppText(to, body) {
  // delay natural
  const delay = 700 + Math.floor(Math.random() * 900);
  await sleep(delay);

  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
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
      timeout: 15000,
    }
  );
}

async function sendMapsLink(to, storeKey) {
  const store = BUSINESS.arsenal.stores[storeKey];
  const txt =
    `${store.label}\n` +
    `${store.address}\n` +
    `Mapa: ${store.mapsLink}`;
  await sendWhatsAppText(to, txt);
}

/* -----------------------------
   HELPERS DE RESPOSTA PRONTA
-------------------------------- */
function formatHours(hoursArr) {
  return hoursArr.map((h) => `• ${h.day}: ${h.hours}`).join("\n");
}

function replyHoursAll() {
  const a = BUSINESS.arsenal.stores.galeriaSuica;
  const b = BUSINESS.arsenal.stores.vilaGermanica;

  return (
    `Horários do ${BUSINESS.arsenal.name}:\n\n` +
    `${a.label}\n${formatHours(a.hours)}\n\n` +
    `${b.label}\n${formatHours(b.hours)}\n\n` +
    `Se for feriado ou feriado prolongado, a gente costuma estender e ir até mais tarde. Se você me disser a data, eu te confirmo o horário certinho.`
  );
}

function replyAddressAll() {
  const a = BUSINESS.arsenal.stores.galeriaSuica;
  const b = BUSINESS.arsenal.stores.vilaGermanica;

  return (
    `Temos duas lojas em Monte Verde:\n\n` +
    `1) ${a.label}\n${a.address}\nMapa: ${a.mapsLink}\n\n` +
    `2) ${b.label}\n${b.address}\nMapa: ${b.mapsLink}\n\n` +
    `Quer ir em qual hoje?`
  );
}

function replyTasting() {
  const t = BUSINESS.arsenal.tasting;
  return (
    `${t.name} funciona assim:\n` +
    `${t.howItWorks}\n` +
    `Valor: ${t.price}. ${t.note}\n\n` +
    `Quer ir em qual loja hoje, Galeria Suíça ou Vila Germânica?`
  );
}

function replyKit() {
  const k = BUSINESS.arsenal.kitInstagram;
  return (
    `${k.name}:\n` +
    `${k.description}\n` +
    `Valor: ${k.price}.\n\n` +
    `${k.reservationPolicy}\n` +
    `Se você me disser em qual loja vai, eu te mando o mapa.`
  );
}

function replyOnline() {
  const o = BUSINESS.arsenal.onlineSales;
  return (
    `Enviamos sim 😊\n` +
    `${o.shipping}\n\n` +
    `Para te indicar certinho os rótulos e montar seu kit, chama o ${o.personName}, nosso ${o.role}:\n` +
    `${o.phone}`
  );
}

function replyInfluencer() {
  const i = BUSINESS.arsenal.influencers;
  return (
    `Parcerias e influencers:\n` +
    `Me manda aqui seu @ do Instagram, cidade e o que você quer propor.\n\n` +
    `E se preferir falar direto com quem cuida disso, chama o ${i.personName} (${i.role}):\n` +
    `${i.phone}`
  );
}

function replySupplier() {
  return (
    `Fornecedores:\n` +
    `Me manda por aqui seu catálogo, tabela/condições, prazos e cidade.\n` +
    `Se tiver portfólio/Instagram, pode mandar também. Eu mesmo avalio e retorno.`
  );
}

function replySmartTapHelp() {
  return (
    `Entendi. Vamos resolver.\n\n` +
    `Me diga, por favor:\n` +
    `• qual foi o problema (chope não saiu, espumou, pix não liberou, etc.)\n` +
    `• horário aproximado\n` +
    `• qual torneira\n\n` +
    `Com isso eu já consigo encaminhar a verificação.\n` +
    `Obs: quando o chope não libera, normalmente o Pix é estornado automaticamente.`
  );
}

function replySmartTapNoCPF() {
  return (
    `Tranquilo 👍 não precisa enviar CPF.\n\n` +
    `Para eu conseguir localizar mais rápido, me diga:\n` +
    `• horário aproximado\n` +
    `• qual torneira\n` +
    `• valor do Pix\n\n` +
    `Se não tiver tudo, manda o que lembrar que a gente verifica.`
  );
}

function replyFranchiseLead() {
  const f = BUSINESS.smartTap.franchise;
  return (
    `${f.status}\n\n` +
    `${f.leadFields}\n` +
    `Pode me mandar aqui mesmo nessa ordem:\n` +
    `1) Nome completo\n2) Telefone\n3) E-mail\n\n` +
    `Assim que estiver liberado, a equipe SmartTap entra em contato.`
  );
}

/* -----------------------------
   DETECÇÃO DE INTENÇÃO (roteador)
-------------------------------- */
function detectIntent(msg, session) {
  const n = normalize(msg);

  // “sim”, “pode”, “me envia” precisa olhar o que estava pendente
  if (["sim", "pode", "ok", "manda", "me envia", "envia", "pode mandar"].includes(n)) {
    if (session.state.waiting === "MAPS_STORE_CHOICE") return "SEND_MAPS_AFTER_CHOICE";
  }

  // endereços / localização
  if (n.includes("endereco") || n.includes("endereço") || n.includes("localizacao") || n.includes("localização") || n.includes("maps") || n.includes("como chegar")) {
    return "ADDRESS_ALL";
  }

  // “outra loja”
  if (n.includes("outra loja") || n.includes("segunda loja") || n.includes("loja da vila") || n.includes("vila germanica") || n.includes("bradesco")) {
    session.state.lastStore = "vilaGermanica";
    return "MAPS_ONE";
  }
  if (n.includes("galeria suica") || n.includes("suica") || n.includes("perto do lago") || n.includes("lago")) {
    session.state.lastStore = "galeriaSuica";
    return "MAPS_ONE";
  }

  // horários
  if (n.includes("horario") || n.includes("horário") || n.includes("aberto") || n.includes("funcionamento") || n.includes("fecha") || n.includes("abre")) {
    return "HOURS_ALL";
  }

  // régua degustação
  if (n.includes("regua") || n.includes("régua") || n.includes("degustacao") || n.includes("degustação")) {
    return "TASTING";
  }

  // kit do anúncio
  if (n.includes("kit") || n.includes("reservar") || n.includes("anuncio") || n.includes("anúncio") || n.includes("39,90") || n.includes("39.90")) {
    return "KIT";
  }

  // pet
  if (n.includes("pet") || n.includes("cachorro") || n.includes("cão")) {
    return "PET";
  }

  // reservas
  if (n.includes("reserva") || n.includes("reservar")) {
    return "RESERVATIONS";
  }

  // envio/online
  if (
    n.includes("vocês enviam") ||
    n.includes("voces enviam") ||
    n.includes("entrega") ||
    n.includes("comprar online") ||
    n.includes("sedex") ||
    n.includes("pac") ||
    n.includes("envio para")
  ) {
    return "ONLINE";
  }

  // influencers/parceria
  if (n.includes("influencer") || n.includes("parceria") || n.includes("permuta") || n.includes("media kit") || n.includes("midiakit")) {
    return "INFLUENCER";
  }

  // fornecedor
  if (n.includes("fornecedor") || n.includes("representante") || n.includes("distribuidor") || n.includes("tabela") || n.includes("catalogo") || n.includes("catálogo")) {
    return "SUPPLIER";
  }

  // SmartTap problemas
  if (n.includes("smarttap") || n.includes("smart tap") || n.includes("chope nao saiu") || n.includes("chopp nao saiu") || n.includes("espuma") || n.includes("pix") || n.includes("estorno")) {
    // se a pessoa fala “não vou enviar cpf”
    if (n.includes("nao vou enviar") || n.includes("não vou enviar") || n.includes("cpf")) {
      return "SMARTTAP_NO_CPF";
    }
    return "SMARTTAP_HELP";
  }

  // franquia
  if (n.includes("franquia") || n.includes("cof") || n.includes("quero ser franqueado") || n.includes("investir")) {
    return "FRANCHISE";
  }

  return "AI";
}

/* -----------------------------
   OPENAI (só quando não cair em fluxo)
-------------------------------- */
function buildSystemPrompt() {
  const a = BUSINESS.arsenal;
  const s = BUSINESS.smartTap;

  return (
    `Você é o atendimento do ${a.name} e do ${s.name} em ${a.city}.\n` +
    `Regras importantes:\n` +
    `1) Não invente horário, endereço, preço, política ou informações. Use apenas os dados fornecidos.\n` +
    `2) Não peça CPF. Para problemas SmartTap, peça horário aproximado, torneira e valor do Pix.\n` +
    `3) Não prometa enviar "localização" se você não estiver enviando um link do Maps.\n` +
    `4) Se o usuário disser "me envia" ou "pode", descubra o que ele quer (qual loja) antes.\n` +
    `5) Seja direto, simpático e natural. Sem parecer robô.\n\n` +
    `Dados oficiais:\n` +
    `- Sobre: ${a.description}\n` +
    `- Lojas:\n` +
    `  * ${a.stores.galeriaSuica.label}: ${a.stores.galeriaSuica.address}\n` +
    `    Horários: ${a.stores.galeriaSuica.hours.map(h=>`${h.day} ${h.hours}`).join("; ")}\n` +
    `  * ${a.stores.vilaGermanica.label}: ${a.stores.vilaGermanica.address}\n` +
    `    Horários: ${a.stores.vilaGermanica.hours.map(h=>`${h.day} ${h.hours}`).join("; ")}\n` +
    `- Régua: ${a.tasting.howItWorks} Valor ${a.tasting.price}. ${a.tasting.note}\n` +
    `- Reservas: ${a.policies.reservations}\n` +
    `- Pet: ${a.policies.pet}\n` +
    `- Kit anúncio: ${a.kitInstagram.description} (${a.kitInstagram.price}). ${a.kitInstagram.reservationPolicy}\n` +
    `- Envio online: ${a.onlineSales.shipping}. Contato ${a.onlineSales.personName} (${a.onlineSales.role}) ${a.onlineSales.phone}\n` +
    `- Influencers: contato ${a.influencers.personName} ${a.influencers.phone}\n` +
    `- SmartTap: ${s.description}\n` +
    `- Franquia SmartTap: ${s.franchise.status} Capturar lead: ${s.franchise.leadFields}\n`
  );
}

async function askOpenAI(session, userMessage) {
  const system = buildSystemPrompt();

  // resumo do contexto em 1 bloco curto
  const contextSummary = session.history
    .slice(-8)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const messages = [
    { role: "system", content: system },
    { role: "system", content: `Contexto recente:\n${contextSummary}` },
    { role: "user", content: userMessage },
  ];

  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  return resp.data.choices?.[0]?.message?.content?.trim() || "Consegue me explicar melhor o que você precisa?";
}

/* -----------------------------
   ROTAS
-------------------------------- */
app.get("/", (req, res) => {
  res.send("Chatbot Arsenal/SmartTap está rodando.");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const msgData = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msgData?.from;
    const messageId = msgData?.id;
    const message = msgData?.text?.body;

    if (!from || !message) return res.sendStatus(200);

    // dedupe: evita respostas duplicadas
    if (messageId && processedMessages.has(messageId)) return res.sendStatus(200);
    if (messageId) processedMessages.add(messageId);

    const session = getSession(from);
    pushHistory(session, "user", message);

    const intent = detectIntent(message, session);

    let reply = null;

    switch (intent) {
      case "HOURS_ALL":
        reply = replyHoursAll();
        break;

      case "ADDRESS_ALL":
        // pede escolha para mandar mapa certo
        session.state.waiting = "MAPS_STORE_CHOICE";
        reply =
          replyAddressAll() +
          `\n\nSe você me disser "Galeria Suíça" ou "Vila Germânica", eu te mando o link do Maps certinho.`;
        break;

      case "MAPS_ONE":
        if (session.state.lastStore) {
          await sendMapsLink(from, session.state.lastStore);
          session.state.waiting = null;
          pushHistory(session, "assistant", `Enviei mapa: ${session.state.lastStore}`);
          return res.sendStatus(200);
        }
        reply = replyAddressAll();
        session.state.waiting = "MAPS_STORE_CHOICE";
        break;

      case "SEND_MAPS_AFTER_CHOICE":
        // se pessoa respondeu “sim/pode” mas não disse qual loja, pergunta de forma simples
        reply = `Perfeito. Qual loja você quer no Maps, Galeria Suíça ou Vila Germânica?`;
        session.state.waiting = "MAPS_STORE_CHOICE";
        break;

      case "TASTING":
        reply = replyTasting();
        break;

      case "KIT":
        reply = replyKit();
        break;

      case "PET":
        reply = `${BUSINESS.arsenal.policies.pet} 🐾`;
        break;

      case "RESERVATIONS":
        reply = BUSINESS.arsenal.policies.reservations;
        break;

      case "ONLINE":
        reply = replyOnline();
        break;

      case "INFLUENCER":
        reply = replyInfluencer();
        break;

      case "SUPPLIER":
        reply = replySupplier();
        break;

      case "SMARTTAP_HELP":
        reply = replySmartTapHelp();
        break;

      case "SMARTTAP_NO_CPF":
        reply = replySmartTapNoCPF();
        break;

      case "FRANCHISE":
        reply = replyFranchiseLead();
        break;

      case "AI":
      default:
        reply = await askOpenAI(session, message);
        break;
    }

    // se o usuário digita o nome da loja enquanto estava esperando escolha
    const n = normalize(message);
    if (session.state.waiting === "MAPS_STORE_CHOICE") {
      if (n.includes("suica") || n.includes("suiça") || n.includes("lago")) {
        session.state.lastStore = "galeriaSuica";
        session.state.waiting = null;
        await sendMapsLink(from, "galeriaSuica");
        pushHistory(session, "assistant", "Enviei mapa Galeria Suíça");
        return res.sendStatus(200);
      }
      if (n.includes("vila") || n.includes("germanica") || n.includes("germânica") || n.includes("bradesco")) {
        session.state.lastStore = "vilaGermanica";
        session.state.waiting = null;
        await sendMapsLink(from, "vilaGermanica");
        pushHistory(session, "assistant", "Enviei mapa Vila Germânica");
        return res.sendStatus(200);
      }
    }

    await sendWhatsAppText(from, reply);
    pushHistory(session, "assistant", reply);

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook:", err.response?.data || err.message);
    return res.sendStatus(200); // melhor responder 200 para a Meta não reenviar em loop
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
