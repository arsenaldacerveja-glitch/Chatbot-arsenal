require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "2mb" }));

const {
  PORT = 3000,
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  WEBSITE_URL = "",
  IMG_REGUA_URL = "",
} = process.env;

if (!VERIFY_TOKEN || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID || !OPENAI_API_KEY) {
  console.error("Faltam variáveis no .env.");
  process.exit(1);
}

/* =========================================================
   CONFIG
========================================================= */
const OPENAI_TIMEOUT_MS = 12000;
const MAX_HISTORY = 12;
const MAX_DEDUP = 8000;
const SESSION_TTL_MS = 1000 * 60 * 45;

/* =========================================================
   MEMÓRIA E DEDUP
========================================================= */
const sessions = new Map();
const processedMsgIds = new Map();

function getSession(waId) {
  const now = Date.now();

  if (!sessions.has(waId)) {
    sessions.set(waId, {
      history: [],
      lastStore: null,
      lastTopic: null,
      lastQuestionType: null,
      sentLocationsAt: 0,
      lastSeenAt: now,
    });
  }

  const session = sessions.get(waId);
  session.lastSeenAt = now;
  return session;
}

function pushHistory(session, role, content) {
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) {
    session.history = session.history.slice(-MAX_HISTORY);
  }
}

function cleanupMemory() {
  const now = Date.now();

  for (const [k, s] of sessions.entries()) {
    if (now - s.lastSeenAt > SESSION_TTL_MS) {
      sessions.delete(k);
    }
  }

  for (const [k, ts] of processedMsgIds.entries()) {
    if (now - ts > 1000 * 60 * 30) {
      processedMsgIds.delete(k);
    }
  }

  if (processedMsgIds.size > MAX_DEDUP) {
    const keys = [...processedMsgIds.keys()].slice(0, Math.floor(MAX_DEDUP / 2));
    keys.forEach((k) => processedMsgIds.delete(k));
  }
}

/* =========================================================
   DADOS FIXOS
========================================================= */
const CONTACTS = {
  kaique: "+55 35 99902-2256",
  kelvim: "+55 35 99189-7704",
};

const STORES = {
  suica: {
    name: "Arsenal da Cerveja - Galeria Suíça",
    short: "Galeria Suíça",
    address: "Av. Monte Verde, 858, Galeria Suíça, Loja 4, Monte Verde - MG",
    maps: "https://maps.google.com/?q=Av+Monte+Verde+858+Monte+Verde+MG",
    hoursByDay: {
      0: "10h às 19h",
      1: "Fechado",
      2: "Fechado",
      3: "10h às 19h",
      4: "10h às 19h",
      5: "10h às 23h",
      6: "10h à 00h",
    },
  },
  germanica: {
    name: "Arsenal Store - Galeria Vila Germânica",
    short: "Galeria Vila Germânica",
    address: "Av. Monte Verde, 1057, Galeria Vila Germânica, Monte Verde - MG",
    maps: "https://maps.google.com/?q=Av+Monte+Verde+1057+Monte+Verde+MG",
    hoursByDay: {
      0: "10h às 19h",
      1: "10h às 19h",
      2: "10h às 19h",
      3: "10h às 19h",
      4: "10h às 19h",
      5: "10h às 23h",
      6: "10h à 00h",
    },
  },
  smarttap: {
    name: "SmartTap - Galeria Itália",
    short: "SmartTap",
    address: "Av. Monte Verde, 561, Galeria Itália, Monte Verde - MG",
    maps: "https://maps.google.com/?q=Av+Monte+Verde+561+Monte+Verde+MG",
    hours: "24 horas, todos os dias. Não fecha.",
  },
};

const GREETING_VARIATIONS = [
  "Olá! Boa noite, seja bem-vindo ao Arsenal da Cerveja em Monte Verde. 🍻\n\nComo posso te ajudar hoje?",
  "Olá! Seja bem-vindo ao Arsenal da Cerveja em Monte Verde. 🍻\n\nComo posso te ajudar hoje?",
  "Boa noite! Seja bem-vindo ao Arsenal da Cerveja em Monte Verde. 🍻\n\nComo posso te ajudar hoje?",
];

const REGUA_TEXT =
  "A régua degustação é o carro-chefe da casa: você escolhe 4 estilos de chopp, com 200ml cada taça, total de 800ml. Valor: R$60.";

const MENU_SUICA = `Na *Galeria Suíça*, além dos chopes, também servimos porções mineiras com produtos da região.

*🥩 Tábua de Frios - R$110*
Nosso carro-chefe das porções.

Brie, Gouda, Gorgonzola, Parmesão, Eisbein defumado, linguiça defumada recheada com provolone, lombo condimentado e salame.

Acompanha:
torradas, chutney de cebola e especiarias, geleia de morango, molho de mostarda com maracujá e molho agridoce com gengibre.

*🍖 Mix de Embutidos - R$70*
Eisbein defumado, linguiça defumada recheada com provolone, lombo condimentado e salame.

Acompanha:
torradas, mostarda com maracujá e chutney de cebola e especiarias.

*🧀 Mix de Queijos - R$70*
Brie, Gouda, Gorgonzola e Parmesão.

Acompanha:
torradas, geleia de morango e chutney de cebola e especiarias.

*Porções individuais*
- Eisbein defumado - R$40
  acompanha torradas e geleia de pimenta
- Lombo condimentado - R$40
  acompanha molho agridoce com gengibre
- Linguiça defumada recheada com provolone - R$40
  acompanha torradas e mostarda com maracujá
- Salame - R$30
- Brie com geleia de morango - R$45
  acompanha torradas
- Gouda - R$45
  acompanha torradas
- Gorgonzola - R$45
  acompanha torradas
- Parmesão - R$45
  acompanha torradas

Pra acompanhar, muita gente pede também a *régua degustação*. 🍻`;

const CHOPP_TEXT = `Nas lojas, os chopes mudam conforme a sazonalidade e cada unidade pode ter opções diferentes.

Geralmente aparecem estilos como:
• Pilsen
• Witbier
• American IPA
• Double IPA
• New England IPA
• Double New England IPA
• Imperial Stout
• Fruitbier com maçã verde
• Chopp de vinho
• Sour

Na *SmartTap*, normalmente temos fixo:
• Pilsen
• IPA
• Dunkel
• Chopp de vinho
• Cannabis
• Gin Tônica com frutas amarelas

Se for sua primeira vez, a melhor forma de experimentar é pela *régua degustação*.`;

const SITE_FALLBACK = WEBSITE_URL
  ? `Pra não te passar informação errada, vou te mandar nosso site oficial: ${WEBSITE_URL}`
  : `Pra não te passar informação errada, me fala se sua dúvida é sobre Galeria Suíça, Vila Germânica ou SmartTap.`;

/* =========================================================
   UTILS
========================================================= */
function normalize(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function hasAny(text, arr) {
  return arr.some((item) => text.includes(item));
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getBrazilDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const data = {};
  for (const p of parts) data[p.type] = p.value;

  let day = 0;
  const w = (data.weekday || "").toLowerCase();

  if (w.includes("sun")) day = 0;
  else if (w.includes("mon")) day = 1;
  else if (w.includes("tue")) day = 2;
  else if (w.includes("wed")) day = 3;
  else if (w.includes("thu")) day = 4;
  else if (w.includes("fri")) day = 5;
  else day = 6;

  return {
    day,
    hour: parseInt(data.hour || "0", 10),
  };
}

function getBrazilDayName(day) {
  return ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][day];
}

function parseHourRange(text) {
  if (!text || normalize(text) === "fechado") return null;
  const match = text.match(/(\d{1,2})h\s*(?:às|a)\s*(\d{1,2})h?/i);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  let end = parseInt(match[2], 10);
  if (end === 0) end = 24;

  return { start, end };
}

function isOpenNow(storeKey) {
  if (storeKey === "smarttap") {
    return { open: true, todayHours: "24 horas, todos os dias" };
  }

  const { day, hour } = getBrazilDate();
  const todayHours = STORES[storeKey].hoursByDay[day];
  const range = parseHourRange(todayHours);

  if (!range) {
    return { open: false, todayHours };
  }

  return {
    open: hour >= range.start && hour < range.end,
    todayHours,
  };
}

function detectStore(text, session) {
  const t = normalize(text);

  if (hasAny(t, ["suica", "suíça", "galeria suica", "galeria suíça"])) return "suica";
  if (hasAny(t, ["germanica", "germânica", "vila germanica", "vila germânica", "arsenal store"])) return "germanica";
  if (hasAny(t, ["smarttap", "smart tap", "galeria italia", "galeria itália"])) return "smarttap";

  return session.lastStore || null;
}

function isConfirmation(text) {
  const t = normalize(text);
  return ["sim", "manda", "pode", "ok", "quero", "isso", "vai", "envia", "me manda", "pode mandar"].includes(t);
}

function looksLikeRefundIssue(text) {
  const t = normalize(text);
  return hasAny(t, [
    "nao saiu",
    "não saiu",
    "meu chope",
    "meu chopp",
    "estorno",
    "pix",
    "paguei",
    "pagamento",
    "nao liberou",
    "não liberou",
    "espumando",
    "espuma",
  ]);
}

function looksLikeInfluencer(text) {
  const t = normalize(text);
  return hasAny(t, ["influencer", "parceria", "media kit", "publi", "permuta"]);
}

function wantsRulerPhoto(text) {
  const t = normalize(text);
  return hasAny(t, ["foto da regua", "foto da régua", "foto da degustacao", "foto da degustação"]);
}

function shouldSendReguaImage(text) {
  const t = normalize(text);
  if (looksLikeRefundIssue(t) || looksLikeInfluencer(t)) return false;

  return hasAny(t, [
    "regua",
    "régua",
    "degustacao",
    "degustação",
    "primeira vez",
    "vale a pena",
    "o que voce recomenda",
    "o que você recomenda",
    "o que pedir",
  ]);
}

function buildMapsBlock(keys) {
  return keys
    .map((key) => {
      const s = STORES[key];
      return `📍 *${s.name}*
${s.address}
Mapa: ${s.maps}`;
    })
    .join("\n\n");
}

/* =========================================================
   INTENÇÕES
========================================================= */
function detectIntent(text, session) {
  const t = normalize(text);

  if (isConfirmation(t)) return "confirmation";
  if (hasAny(t, ["oi", "ola", "olá", "boa noite", "bom dia", "boa tarde"])) return "greeting";
  if (looksLikeInfluencer(t)) return "influencer";
  if (looksLikeRefundIssue(t)) return "smarttap_support";
  if (wantsRulerPhoto(t)) return "regua_photo";

  if (hasAny(t, ["cardapio", "cardápio", "porcao", "porção", "tabua", "tábua", "frios", "embutidos", "queijos"])) return "menu";
  if (hasAny(t, ["horario", "horário", "aberto", "aberta", "fecha", "fechado", "funciona hoje", "aberto hoje"])) return "hours";
  if (hasAny(t, ["localizacao", "localização", "endereco", "endereço", "maps", "onde fica", "manda a localizacao", "manda a localização"])) return "location";
  if (hasAny(t, ["regua", "régua", "degustacao", "degustação"])) return "regua";
  if (hasAny(t, ["pet", "pets", "cachorro", "gato"])) return "pets";
  if (hasAny(t, ["copo", "copos", "taca", "taça", "caneca", "canecas"])) return "glasses";
  if (hasAny(t, ["online", "on-line", "envio", "sedex", "pac", "entrega", "vende online", "vendem online"])) return "shipping";
  if (hasAny(t, ["chopp", "chope", "torneira", "engatado", "estilo"])) return "chopp";
  if (hasAny(t, ["franquia", "franqueado", "cof"])) return "franchise";
  if (hasAny(t, ["reserva", "reservar"])) return "reservation";

  return "fallback";
}

/* =========================================================
   RESPOSTAS FIXAS
========================================================= */
function buildGreetingReply(session) {
  session.lastTopic = "greeting";
  return randomItem(GREETING_VARIATIONS);
}

function buildHoursReply(session, text) {
  const store = detectStore(text, session);
  const { day } = getBrazilDate();
  const dayName = getBrazilDayName(day);

  session.lastTopic = "hours";
  session.lastQuestionType = "location_followup";

  if (!store) {
    return `Hoje é *${dayName}*.

• *Galeria Suíça*: ${STORES.suica.hoursByDay[day]}
• *Galeria Vila Germânica*: ${STORES.germanica.hoursByDay[day]}
• *SmartTap*: 24 horas, todos os dias

Se quiser, eu te mando a localização certinha.`;
  }

  session.lastStore = store;

  if (store === "smarttap") {
    return `A *SmartTap* funciona *24 horas, todos os dias*. Não fecha. 🍻

Ela fica na *Galeria Itália*, Av. Monte Verde, 561.

Se quiser, eu já te mando a localização.`;
  }

  if (store === "suica") {
    if (day === 1 || day === 2) {
      return `Hoje é *${dayName}* e a *Galeria Suíça* está *fechada*.

Mas você tem duas alternativas agora:
• *Arsenal Store - Galeria Vila Germânica*: ${STORES.germanica.hoursByDay[day]}
• *SmartTap*: 24 horas, todos os dias

Se quiser, eu te mando a localização certinha.`;
    }

    const { open, todayHours } = isOpenNow("suica");
    if (open) {
      return `Hoje é *${dayName}* e a *Galeria Suíça* está aberta *${todayHours}*.

Se você vier, vale a pena pedir a nossa *régua degustação* ou a *tábua de frios*. 🍻

Se quiser, eu já te mando a localização.`;
    }

    return `Hoje é *${dayName}* e a *Galeria Suíça* funciona *${todayHours}*.

Se estiver procurando algo agora, você também tem:
• *Galeria Vila Germânica*
• *SmartTap 24h*

Se quiser, eu te mando a localização.`;
  }

  const { open, todayHours } = isOpenNow("germanica");
  if (open) {
    return `Hoje é *${dayName}* e a *Galeria Vila Germânica* está aberta *${todayHours}*.

Se quiser uma alternativa a qualquer hora, a *SmartTap* funciona 24 horas todos os dias.

Se quiser, eu já te mando a localização.`;
  }

  return `Hoje é *${dayName}* e a *Galeria Vila Germânica* funciona *${todayHours}*.

Se estiver fora do horário, a *SmartTap* resolve porque funciona 24 horas todos os dias.

Se quiser, eu já te mando a localização.`;
}

function buildLocationReply(session, text) {
  const t = normalize(text);
  const wantsBoth = hasAny(t, ["das duas", "duas", "duas lojas", "as duas"]);

  session.lastTopic = "location";

  if (wantsBoth) {
    session.sentLocationsAt = Date.now();
    return `${buildMapsBlock(["suica", "germanica"])}

E se quiser algo rápido a qualquer hora, tem também a *SmartTap*:
${STORES.smarttap.maps}`;
  }

  const store = detectStore(text, session);

  if (store === "suica") {
    session.lastStore = "suica";
    return `📍 *${STORES.suica.name}*
${STORES.suica.address}
Mapa: ${STORES.suica.maps}

Se for sua primeira vez, vale muito a pena provar a *régua degustação*. 🍻`;
  }

  if (store === "germanica") {
    session.lastStore = "germanica";
    return `📍 *${STORES.germanica.name}*
${STORES.germanica.address}
Mapa: ${STORES.germanica.maps}

Se quiser, depois também te mando a da Galeria Suíça.`;
  }

  if (store === "smarttap") {
    session.lastStore = "smarttap";
    return `📍 *${STORES.smarttap.name}*
${STORES.smarttap.address}
Mapa: ${STORES.smarttap.maps}

Ela funciona *24 horas, todos os dias*.`;
  }

  session.sentLocationsAt = Date.now();
  return buildMapsBlock(["suica", "germanica", "smarttap"]);
}

function buildMenuReply(session) {
  session.lastStore = "suica";
  session.lastTopic = "menu";
  return MENU_SUICA;
}

function buildReguaReply(session) {
  session.lastTopic = "regua";
  session.lastQuestionType = "location_followup";
  return `${REGUA_TEXT}

Se quiser, eu também posso te mandar a localização da *Galeria Suíça* ou da *Galeria Vila Germânica*.`;
}

function buildPetsReply(session) {
  session.lastTopic = "pets";
  return `Sim, aceitamos pets. 🐾

Inclusive temos uma bebida feita especialmente para pets.

Se estiver passeando por Monte Verde com seu pet, vale a visita.`;
}

function buildGlassesReply(session) {
  session.lastTopic = "glasses";
  return `Temos sim. 🍻

Aqui no Arsenal temos taças, copos e canecas, incluindo modelos personalizados e também alguns importados.

Se você quiser ver opções para envio ou escolher um modelo específico, fala com o *Kaique*:
${CONTACTS.kaique}`;
}

function buildShippingReply(session) {
  session.lastTopic = "shipping";
  return `Vendemos on-line e enviamos para todo o Brasil via PAC ou Sedex.

Pra montar kit, escolher o estilo certo, acertar em presente, temperatura ou taça ideal, fala com o *Kaique*, nosso Beer Sommelier:
${CONTACTS.kaique}`;
}

function buildInfluencerReply(session) {
  session.lastTopic = "influencer";
  return `Fechamos sim parcerias com influencers. 😄

Pode me mandar por aqui:
• seu @ do Instagram
• sua cidade
• a ideia da parceria

E se preferir falar direto com quem cuida disso, chama o *Kelvim*:
${CONTACTS.kelvim}`;
}

function buildSmartTapSupportReply(session) {
  session.lastTopic = "smarttap_support";
  return `Calma, a gente resolve isso com você agora. 🍻

Pra eu te orientar certinho:
1) Você ainda está perto da SmartTap?
2) Qual foi o horário aproximado do Pix?
3) Você consegue mandar um print do comprovante do Pix?

Geralmente o estorno é automático e cai em instantes, mas pode variar de banco para banco. Me manda essas informações que eu já agilizo.`;
}

function buildChoppReply(session) {
  session.lastTopic = "chopp";
  session.lastQuestionType = "location_followup";
  return `Nas lojas do Arsenal da Cerveja, os chopes mudam conforme a sazonalidade e cada unidade pode ter opções diferentes.

Geralmente você encontra estilos como:
• Pilsen
• Witbier
• American IPA
• Double IPA
• New England IPA
• Double New England IPA
• Imperial Stout
• Fruitbier com maçã verde
• Chopp de vinho
• Sour

Na nossa máquina autônoma *SmartTap*, que fica na *Galeria Itália*, normalmente temos fixo:
• Pilsen
• IPA
• Dunkel
• Chopp de vinho
• Cannabis
• Gin Tônica com frutas amarelas

Se for sua primeira vez, a melhor forma de experimentar é pela *régua degustação*.

Se quiser, te mando a localização agora.`;
}

function buildReservationReply(session) {
  session.lastTopic = "reservation";
  return `A gente não trabalha com reservas. O atendimento é por ordem de chegada.

Se for sua primeira vez, uma ótima pedida é a *régua degustação*. 🍻`;
}

function buildFranchiseReply(session) {
  session.lastTopic = "franchise";
  return `Sobre franquia, estamos estruturando isso.

Se quiser, me manda seu nome e seu WhatsApp de contato que a equipe retorna com mais informações.`;
}

function handleConfirmation(session) {
  if (session.lastQuestionType === "location_followup") {
    session.lastQuestionType = null;

    if (session.lastStore) {
      return buildLocationReply(session, session.lastStore);
    }

    return buildLocationReply(session, "das duas");
  }

  return "Claro. Me fala só o que você precisa e eu já te respondo.";
}

/* =========================================================
   OPENAI FALLBACK
========================================================= */
function buildSystemPrompt() {
  return `Você é o atendimento oficial do Arsenal da Cerveja e da SmartTap em Monte Verde.

Regras:
- Responda em português BR.
- Seja direto, humano e cordial.
- Nunca invente horário, endereço, preço, contato ou cardápio.
- Não use menu robótico.
- Se não tiver certeza absoluta da informação, diga:
"${SITE_FALLBACK}"

Fatos:
- Galeria Suíça: Av. Monte Verde, 858, Loja 4. Fecha segunda e terça.
- Vila Germânica: Av. Monte Verde, 1057. Abre todos os dias.
- SmartTap: Av. Monte Verde, 561, Galeria Itália. Funciona 24 horas, todos os dias.
- Kaique: ${CONTACTS.kaique}
- Kelvim: ${CONTACTS.kelvim}
- Régua degustação: 4 estilos, 200ml cada taça, total 800ml, valor R$60.`;
}

async function generateAIReply(session, userText) {
  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...session.history,
    { role: "user", content: userText },
  ];

  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: OPENAI_MODEL,
      temperature: 0.3,
      messages,
      max_tokens: 250,
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: OPENAI_TIMEOUT_MS,
    }
  );

  return resp.data?.choices?.[0]?.message?.content?.trim() || "";
}

/* =========================================================
   WHATSAPP
========================================================= */
async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
}

async function sendWhatsAppImage(to, imageUrl, caption) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
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
      timeout: 10000,
    }
  );
}

/* =========================================================
   WEBHOOK
========================================================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    cleanupMemory();

    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || !messages.length) return res.sendStatus(200);

    const msg = messages[0];
    const from = msg.from;
    const msgId = msg.id;

    if (!from || !msgId) return res.sendStatus(200);

    if (processedMsgIds.has(msgId)) return res.sendStatus(200);
    processedMsgIds.set(msgId, Date.now());

    const userText =
      msg.text?.body ||
      msg.button?.text ||
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      "";

    if (!userText) return res.sendStatus(200);

    const session = getSession(from);
    pushHistory(session, "user", userText);

    const intent = detectIntent(userText, session);
    let reply = "";

    if (intent === "confirmation") {
      reply = handleConfirmation(session);
    } else if (intent === "greeting") {
      reply = buildGreetingReply(session);
    } else if (intent === "influencer") {
      reply = buildInfluencerReply(session);
    } else if (intent === "smarttap_support") {
      reply = buildSmartTapSupportReply(session);
    } else if (intent === "regua_photo") {
      if (IMG_REGUA_URL) {
        const caption = "🍻 Régua degustação do Arsenal. Você escolhe 4 estilos, 200ml cada taça. Valor: R$60.";
        await sendWhatsAppImage(from, IMG_REGUA_URL, caption);
        pushHistory(session, "assistant", caption);
        return res.sendStatus(200);
      } else {
        reply = `${REGUA_TEXT}

Se quiser, eu te mando a localização da Galeria Suíça ou da Vila Germânica.`;
        session.lastQuestionType = "location_followup";
      }
    } else if (intent === "menu") {
      reply = buildMenuReply(session);
    } else if (intent === "hours") {
      reply = buildHoursReply(session, userText);
    } else if (intent === "location") {
      reply = buildLocationReply(session, userText);
    } else if (intent === "regua") {
      reply = buildReguaReply(session);
    } else if (intent === "pets") {
      reply = buildPetsReply(session);
    } else if (intent === "glasses") {
      reply = buildGlassesReply(session);
    } else if (intent === "shipping") {
      reply = buildShippingReply(session);
    } else if (intent === "chopp") {
      reply = buildChoppReply(session);
    } else if (intent === "franchise") {
      reply = buildFranchiseReply(session);
    } else if (intent === "reservation") {
      reply = buildReservationReply(session);
    } else {
      try {
        reply = await generateAIReply(session, userText);
      } catch (e) {
        console.error("Erro OpenAI:", e?.response?.data || e.message);
        reply = SITE_FALLBACK;
      }

      if (!reply || reply.length < 3) {
        reply = SITE_FALLBACK;
      }
    }

    await sendWhatsAppText(from, reply);
    pushHistory(session, "assistant", reply);

    if (IMG_REGUA_URL && shouldSendReguaImage(userText)) {
      const caption = "🍻 Régua degustação do Arsenal. Você escolhe 4 estilos, 200ml cada taça. Valor: R$60.";
      try {
        await sendWhatsAppImage(from, IMG_REGUA_URL, caption);
        pushHistory(session, "assistant", caption);
      } catch (e) {
        console.error("Erro ao enviar imagem:", e?.response?.data || e.message);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("Erro no webhook:", err?.response?.data || err.message);
    return res.sendStatus(200);
  }
});

app.get("/", (_, res) => res.status(200).send("OK"));

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
