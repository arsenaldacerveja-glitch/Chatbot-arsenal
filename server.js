/**
 * Chatbot Arsenal + SmartTap (WhatsApp Cloud API + OpenAI)
 * - Fluxos fixos para evitar “sem contexto”
 * - Deduplicação de mensagens (evita responder 2x)
 * - Memória curta por usuário (últimas mensagens + flags do que já foi enviado)
 * - Regras claras: horários corretos, cardápio completo, contatos, SmartTap sem CPF e sem “módulo”
 *
 * REQUISITOS (env):
 * OPENAI_API_KEY
 * WHATSAPP_TOKEN
 * PHONE_NUMBER_ID
 * VERIFY_TOKEN
 *
 * OPCIONAIS (recomendado):
 * ARSENAL_SITE_URL             (ex: https://www.arsenaldacerveja.com.br)
 * REGUA_IMAGE_URL              (URL público da foto da régua para enviar no WhatsApp)
 * SMARTTAP_SUPPORT_CONTACT      (telefone/whats de suporte, se você tiver)
 */

const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "2mb" }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const ARSENAL_SITE_URL = process.env.ARSENAL_SITE_URL || "";
const REGUA_IMAGE_URL = process.env.REGUA_IMAGE_URL || "";
const SMARTTAP_SUPPORT_CONTACT = process.env.SMARTTAP_SUPPORT_CONTACT || "";

// -------------------- DADOS OFICIAIS (fixos) --------------------
const CONTACTS = {
  kelvinInfluencers: "+55 35 99189-7704",
  kaiqueSommelier: "+55 35 99902-2256",
};

const LOCATIONS = {
  suica: {
    label: "Arsenal da Cerveja, Galeria Suíça",
    address: "Av. Monte Verde, 858, Galeria Suíça, Loja 4, Monte Verde, MG",
    mapsQuery: "Av Monte Verde 858 Galeria Suíça Loja 4 Monte Verde MG",
  },
  germanica: {
    label: "Arsenal Store, Galeria Vila Germânica",
    address: "Av. Monte Verde, 1057, Galeria Vila Germânica, Monte Verde, MG (próximo ao Bradesco)",
    mapsQuery: "Av Monte Verde 1057 Galeria Vila Germânica Monte Verde MG Bradesco",
  },
  smarttap: {
    label: "SmartTap, Galeria Itália",
    address: "Galeria Itália, Av. Monte Verde, 561, Monte Verde, MG",
    mapsQuery: "Galeria Itália Av Monte Verde 561 Monte Verde MG SmartTap",
  },
};

const HOURS = {
  suica: [
    "Segunda: fechado",
    "Terça: fechado",
    "Quarta: 10h às 19h",
    "Quinta: 10h às 19h",
    "Sexta: 10h às 23h",
    "Sábado: 10h às 00h",
    "Domingo: 10h às 19h",
  ],
  germanica: [
    "Domingo a quinta: 10h às 19h",
    "Sexta: 10h às 23h",
    "Sábado: 10h às 00h",
  ],
  smarttap: [
    "Segunda a sexta: 10h às 23h",
    "Sábado: 10h às 00h",
    "Domingo: 10h às 23h",
  ],
};

const REGUA = {
  title: "Régua de Degustação (carro chefe)",
  text:
    "Você escolhe 4 estilos entre as 6 torneiras disponíveis. Cada taça tem 200ml (total 800ml). Valor: R$60. Dá para dividir entre duas pessoas.",
};

const CARDAPIO_SUICA = {
  header:
    "Na Galeria Suíça, além das cervejas e chopes, a gente serve porções mineiras com produtos da região, perfeitas para acompanhar o chope.",
  destaque:
    "Carro chefe das porções: *Tábua de Frios*.",
  tabuaDeFrios: {
    price: "R$ 110,00",
    items:
      "Brie, Gouda, Gorgonzola, Parmesão, Eisbein defumado, Linguiça defumada recheada com provolone, Lombo condimentado e Salame.",
    acompanha:
      "Acompanha torradas, chutney de cebola e especiarias, geleia de morango, molho de mostarda com maracujá e molho agridoce com gengibre.",
  },
  mixEmbutidos: {
    price: "R$ 70,00",
    items: "Eisbein defumado, Linguiça defumada, Lombo condimentado e Salame.",
    acompanha:
      "Acompanha torradas, molho de mostarda com maracujá e chutney.",
  },
  mixQueijos: {
    price: "R$ 70,00",
    items: "Brie, Gouda, Gorgonzola e Parmesão.",
    acompanha:
      "Acompanha torradas, geleia de morango, chutney e molho de cebola e especiarias.",
  },
  individuais: [
    { name: "Eisbein defumado", price: "R$ 40,00", desc: "Acompanha torradas e geleia de pimenta." },
    { name: "Lombo condimentado", price: "R$ 40,00", desc: "Acompanha torradas e molho agridoce com gengibre." },
    { name: "Linguiça defumada recheada com provolone", price: "R$ 40,00", desc: "Acompanha torradas e molho de mostarda com maracujá." },
    { name: "Salame", price: "R$ 30,00", desc: "" },
    { name: "Brie com geleia de morango", price: "R$ 45,00", desc: "Acompanha torradas." },
    { name: "Gouda", price: "R$ 45,00", desc: "Acompanha torradas." },
    { name: "Gorgonzola", price: "R$ 45,00", desc: "Acompanha torradas." },
    { name: "Parmesão", price: "R$ 45,00", desc: "Acompanha torradas." },
  ],
};

const CHOPP_INFO = {
  lojas:
    "Nas lojas, os chopes mudam conforme a sazonalidade e cada loja pode ter opções diferentes. O mais certeiro é passar lá para ver o que está engatado no momento.",
  estilosSemMarca:
    "Geralmente você encontra estilos como Pilsen, Witbier, American IPA, Double IPA, New England IPA, Double New England, Imperial Stout, Fruitbier (maçã verde), Chopp de vinho e Sour.",
  smarttapFixos:
    "Na SmartTap normalmente temos fixo: Pilsen, IPA, Dunkel, Chopp de vinho, Cannabis e também Gin Tônica (com frutas amarelas).",
};

const FAQ = {
  reservas: "A gente não trabalha com reservas. O atendimento é por ordem de chegada.",
  pets:
    "Sim, aceitamos pets. E temos uma bebida feita especialmente para pets. Se quiser, você encontra por aqui na loja, aí você já conhece e leva na hora.",
  copos:
    `Temos uma variedade de taças, copos e canecas, com opções personalizadas e também importadas. Para te indicar certinho e ver envio, fala com o Kaique (Beer Sommelier, ICB): ${CONTACTS.kaiqueSommelier}`,
  envio:
    `Enviamos para todo o Brasil via PAC ou Sedex. Para montar kit, escolher estilo, temperatura e taça certa, chama o Kaique (Beer Sommelier, ICB): ${CONTACTS.kaiqueSommelier}`,
  influencers:
    `Fazemos sim. Me manda seu @ do Instagram, sua cidade e a proposta. Se preferir falar direto com o responsável: Kelvin (parcerias e influencers): ${CONTACTS.kelvinInfluencers}`,
  franquia:
    "Sobre franquia, a gente está em fase final de estruturação. Se você quiser, me manda seu nome e seu WhatsApp de contato e o melhor horário para retorno.",
};

// -------------------- MEMÓRIA / CONTEXTO (simples, em RAM) --------------------
const sessions = new Map(); // from -> { history: [], flags: {}, lastActive: ms }
const SESSION_TTL_MS = 1000 * 60 * 30; // 30 min
const HISTORY_MAX = 10;

function getSessionKey(from) {
  return String(from || "");
}

function getSession(from) {
  const key = getSessionKey(from);
  const now = Date.now();
  let s = sessions.get(key);
  if (!s) {
    s = { history: [], flags: {}, lastActive: now };
    sessions.set(key, s);
  }
  s.lastActive = now;
  return s;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [k, s] of sessions.entries()) {
    if (now - s.lastActive > SESSION_TTL_MS) sessions.delete(k);
  }
}

// -------------------- DEDUP (evita responder 2x) --------------------
const processedMsgIds = new Map(); // msgId -> timestamp
const DEDUP_TTL_MS = 1000 * 60 * 10;

function isDuplicate(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  const last = processedMsgIds.get(msgId);
  if (last && now - last < DEDUP_TTL_MS) return true;
  processedMsgIds.set(msgId, now);
  return false;
}

function cleanupDedup() {
  const now = Date.now();
  for (const [id, ts] of processedMsgIds.entries()) {
    if (now - ts > DEDUP_TTL_MS) processedMsgIds.delete(id);
  }
}

// -------------------- HELPERS DE TEXTO --------------------
function normalize(text) {
  return String(text || "").toLowerCase().trim();
}

function containsAny(t, arr) {
  return arr.some((k) => t.includes(k));
}

function buildGoogleMapsLink(query) {
  const q = encodeURIComponent(query);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// -------------------- INTENÇÕES (regras rápidas + confiáveis) --------------------
function detectIntent(message) {
  const t = normalize(message);

  // SmartTap problemas / estorno
  if (
    containsAny(t, [
      "meu chope nao saiu",
      "meu chopp nao saiu",
      "meu chope não saiu",
      "meu chopp não saiu",
      "não saiu",
      "nao saiu",
      "nao liberou",
      "não liberou",
      "estorno",
      "pix",
      "paguei",
      "pagamento",
      "cobrou",
    ])
  ) return "SMARTTAP_ISSUE";

  // localização
  if (containsAny(t, ["local", "localização", "localizacao", "endereço", "endereco", "maps", "como chegar"])) return "LOCATION";

  // horários
  if (containsAny(t, ["horário", "horario", "abre", "aberto", "fechado", "funciona hoje", "funcionamento"])) return "HOURS";

  // cardápio / porções
  if (containsAny(t, ["cardápio", "cardapio", "porção", "porcao", "tábua", "tabua", "queijos", "embutidos", "frios"])) return "MENU";

  // régua degustação
  if (containsAny(t, ["régua", "regua", "degustação", "degustacao", "degustar"])) return "REGUA";

  // pets
  if (containsAny(t, ["pet", "pets", "cachorro", "gato", "animal"])) return "PETS";

  // envio/online
  if (containsAny(t, ["envia", "enviam", "online", "on-line", "site", "comprar", "manda", "entrega", "sedex", "pac"])) return "SHIPPING";

  // copos/taças/canecas
  if (containsAny(t, ["taça", "taca", "copos", "copo", "caneca", "taças"])) return "GLASSES";

  // influencer/parceria
  if (containsAny(t, ["influencer", "parceria", "parcerias", "permuta", "publi", "media kit", "mídia kit"])) return "INFLUENCERS";

  // franquia
  if (containsAny(t, ["franquia", "franqueado", "cof"])) return "FRANCHISE";

  // chopp engatado / torneira
  if (containsAny(t, ["chopp", "chope", "torneira", "engatado", "o que tem hoje", "tem o que"])) return "CHOPP";

  // reserva
  if (containsAny(t, ["reserva", "reservar"])) return "RESERVAS";

  // saudação
  if (containsAny(t, ["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite"])) return "GREETING";

  return "OPENAI";
}

// -------------------- RESPOSTAS FIXAS (sem travar, sem inventar) --------------------
function buildGreeting() {
  return (
`E aí! Bem-vindo ao Arsenal da Cerveja, em Monte Verde. 🍻

Aqui você fala com a gente sobre:
1) Arsenal da Cerveja, Galeria Suíça, porções mineiras e régua degustação
2) Arsenal Store, Vila Germânica, chopes e cervejas
3) SmartTap, chope autônomo na rua

Me diz rapidinho o que você precisa agora: horário, localização, régua, cardápio, chopp, envio, copos ou SmartTap?`
  );
}

function buildHoursReply(which) {
  if (which === "suica") {
    return (
`Horários, *Galeria Suíça*:
${HOURS.suica.map((x) => `- ${x}`).join("\n")}

Dica da casa: ${REGUA.title}. ${REGUA.text}`
    );
  }
  if (which === "germanica") {
    return (
`Horários, *Vila Germânica*:
${HOURS.germanica.map((x) => `- ${x}`).join("\n")}

Se você curte experimentar vários estilos, a dica é a régua: ${REGUA.text}`
    );
  }
  if (which === "smarttap") {
    return (
`Horários, *SmartTap*:
${HOURS.smarttap.map((x) => `- ${x}`).join("\n")}

Se precisar de ajuda com Pix, estorno ou liberação, me chama aqui.`
    );
  }

  return (
`Qual unidade você quer?
- Galeria Suíça (porções + régua)
- Vila Germânica (chopes + cervejas)
- SmartTap (chope autônomo)

Me responde com: “Suíça”, “Germânica” ou “SmartTap”.`
  );
}

function detectWhichStoreFromText(message) {
  const t = normalize(message);
  if (t.includes("suica") || t.includes("suíça") || t.includes("galeria suica") || t.includes("galeria suíça")) return "suica";
  if (t.includes("germanica") || t.includes("germânica") || t.includes("vila germanica") || t.includes("vila germânica")) return "germanica";
  if (t.includes("smarttap") || t.includes("smart tap") || t.includes("galeria italia") || t.includes("galeria itália")) return "smarttap";
  return "";
}

function buildLocationReply(session, which) {
  const parts = [];
  const wantAll = !which;

  const maybeAdd = (key) => {
    if (session.flags.lastLocationSent === key) return; // evita repetir
    const loc = LOCATIONS[key];
    parts.push(
`*${loc.label}*
${loc.address}
Mapa: ${buildGoogleMapsLink(loc.mapsQuery)}`
    );
  };

  if (wantAll) {
    maybeAdd("suica");
    maybeAdd("germanica");
    maybeAdd("smarttap");
    if (parts.length === 0) {
      // tudo já foi enviado recentemente
      return "Já te enviei as localizações agora há pouco. Quer a *Suíça*, a *Germânica* ou a *SmartTap* de novo?";
    }
    session.flags.lastLocationSent = "all";
    return (
`Localização das unidades em Monte Verde:

${parts.join("\n\n")}

Quer que eu te indique qual faz mais sentido pelo que você está buscando?`
    );
  }

  maybeAdd(which);
  session.flags.lastLocationSent = which;
  return parts.join("\n\n");
}

function buildMenuReply() {
  const ind = CARDAPIO_SUICA.individuais
    .map((i) => `- ${i.name} ${i.price}${i.desc ? ` (${i.desc})` : ""}`)
    .join("\n");

  return (
`${CARDAPIO_SUICA.header}

${CARDAPIO_SUICA.destaque}
*• Tábua de Frios* ${CARDAPIO_SUICA.tabuaDeFrios.price}
${CARDAPIO_SUICA.tabuaDeFrios.items}
${CARDAPIO_SUICA.tabuaDeFrios.acompanha}

*• Mix de Embutidos* ${CARDAPIO_SUICA.mixEmbutidos.price}
${CARDAPIO_SUICA.mixEmbutidos.items}
${CARDAPIO_SUICA.mixEmbutidos.acompanha}

*• Mix de Queijos* ${CARDAPIO_SUICA.mixQueijos.price}
${CARDAPIO_SUICA.mixQueijos.items}
${CARDAPIO_SUICA.mixQueijos.acompanha}

*Porções individuais:*
${ind}

E pra fechar do jeito certo: ${REGUA.title}. ${REGUA.text}`
  );
}

function buildReguaReply() {
  return (
`${REGUA.title} 🍻
${REGUA.text}

Se você me disser qual loja você vai hoje, eu te mando a localização certinha.`
  );
}

function buildChoppReply() {
  return (
`${CHOPP_INFO.lojas}

Estilos que geralmente rolam por aqui, sem depender de marca:
${CHOPP_INFO.estilosSemMarca}

${CHOPP_INFO.smarttapFixos}

Se você vai na Suíça ou na Germânica, me fala qual delas e eu te mando a localização.`
  );
}

function buildKaiqueLudico() {
  return (
`Quer comprar on-line, montar kit, escolher o estilo certo ou acertar em cheio num presente?

Chama o *Kaique* (Beer Sommelier, formado no Instituto da Cerveja Brasil). Ele te orienta no detalhe:
- estilo ideal pro seu gosto
- temperatura certa
- taça certa
- sugestões pra presente e harmonização

Contato do Kaique: ${CONTACTS.kaiqueSommelier}`
  );
}

function buildSmartTapSupportReply() {
  const extra = SMARTTAP_SUPPORT_CONTACT
    ? `\nSe preferir, também dá pra falar direto com o suporte: ${SMARTTAP_SUPPORT_CONTACT}`
    : "";

  return (
`Puts, entendi. Calma que a gente resolve agora.

Quando o chope não libera na SmartTap, o Pix fica protegido. O *estorno é automático*. Em muitos casos cai em instantes, mas pode variar de banco para banco e levar alguns minutos.

Me manda só 3 coisas rapidinho:
1) Você está aí do lado da máquina agora?
2) Qual foi o *horário aproximado* e o *valor* do Pix?
3) Se puder, manda um *print do comprovante do Pix*.

Com isso eu já te digo o próximo passo.${extra}`
  );
}

function buildLastResort() {
  if (!ARSENAL_SITE_URL) {
    return (
`Eu posso estar sem algum detalhe específico aqui agora.

Se quiser, me manda exatamente o que você precisa (em 1 frase) que eu tento resolver por aqui.
Se preferir, você também pode conferir no nosso site oficial. Se você me passar o link do site, eu já deixo ele fixo aqui pra você.`
    );
  }
  return (
`Posso estar sem algum detalhe específico aqui agora.

Se quiser, você pode conferir no nosso site oficial:
${ARSENAL_SITE_URL}

Se me disser o que você precisa (horário, localização, régua, porções, envio ou SmartTap), eu também te ajudo por aqui.`
  );
}

// -------------------- WhatsApp senders --------------------
async function sendWhatsAppText(to, body) {
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

async function sendWhatsAppImage(to, imageUrl, caption) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption: caption || "" },
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

// -------------------- OpenAI (fallback inteligente) --------------------
function buildSystemPrompt(session) {
  return (
`Você é o atendimento oficial do Arsenal da Cerveja e SmartTap em Monte Verde (MG).
Fale em português, com simpatia, direto ao ponto e com energia.
Você NÃO deve inventar horários, valores, endereços, contatos nem políticas.
Se não tiver certeza, peça a informação em 1 pergunta ou use o fallback do site.

REGRAS CRÍTICAS
1) Nunca pergunte CPF.
2) SmartTap suporte: o cliente pode estar nervoso. Foque em acalmar e resolver:
   - estorno é automático quando não libera
   - pode variar de banco para banco e levar alguns minutos
   - pedir: se está perto, horário+valor, print do Pix
   - não falar de módulo, reiniciar, desligar, torneira etc.
3) Localização: se já enviou uma localização recentemente, não repita no mesmo fluxo. Pergunte qual unidade ele quer.
4) Horários oficiais:
   - Galeria Suíça: Seg fechado, Ter fechado, Qua 10-19, Qui 10-19, Sex 10-23, Sáb 10-00, Dom 10-19
   - Vila Germânica: Dom a Qui 10-19, Sex 10-23, Sáb 10-00
   - SmartTap: Seg a Sex 10-23, Sáb 10-00, Dom 10-23
5) Unidades:
   - Galeria Suíça tem porções mineiras (queijos e embutidos da região) + régua degustação
   - Vila Germânica é focada em chopes e cervejas (sem porções)
   - SmartTap é chope autônomo (Pix)
6) Sempre que o cliente pedir horário, localização ou cardápio, tente vender a régua degustação (sem insistir demais).

CONTATOS
- Kaique (Beer Sommelier, ICB): ${CONTACTS.kaiqueSommelier}
- Kelvin (parcerias/influencers): ${CONTACTS.kelvinInfluencers}

FALLBACK (último caso)
Se não conseguir resolver sem inventar, direcione para o site oficial (se existir) ou peça o link do site.`
  );
}

async function askOpenAI(session, userText) {
  const messages = [
    { role: "system", content: buildSystemPrompt(session) },
    ...session.history,
    { role: "user", content: userText },
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

  const reply = resp?.data?.choices?.[0]?.message?.content?.trim();
  return reply || "";
}

// -------------------- ROTAS --------------------
app.get("/", (req, res) => res.send("Chatbot Arsenal + SmartTap está rodando."));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    cleanupSessions();
    cleanupDedup();

    const entry = req.body.entry?.[0]?.changes?.[0]?.value;
    const msgObj = entry?.messages?.[0];
    const from = msgObj?.from;
    const msgId = msgObj?.id;

    // Ignora status/eco/outros
    if (!msgObj || !from) return res.sendStatus(200);

    // Dedup: evita responder 2x
    if (isDuplicate(msgId)) return res.sendStatus(200);

    const message = msgObj?.text?.body;
    if (!message) return res.sendStatus(200);

    const session = getSession(from);
    const intent = detectIntent(message);
    const which = detectWhichStoreFromText(message);

    // guarda histórico curto (entrada do usuário)
    session.history.push({ role: "user", content: message });
    if (session.history.length > HISTORY_MAX) session.history.shift();

    let reply = "";

    // ----------- FLUXOS FIXOS (sem depender do GPT) -----------
    if (intent === "GREETING") {
      reply = buildGreeting();
    }

    else if (intent === "HOURS") {
      reply = buildHoursReply(which);
    }

    else if (intent === "LOCATION") {
      // Se o cara só falou "a localização" sem dizer qual, manda as 3 uma vez
      reply = buildLocationReply(session, which);
    }

    else if (intent === "MENU") {
      // cardápio é só Suíça
      reply = buildMenuReply();
    }

    else if (intent === "REGUA") {
      reply = buildReguaReply();
      // se tiver imagem configurada, envia junto
      await sendWhatsAppText(from, reply);
      session.history.push({ role: "assistant", content: reply });
      if (session.history.length > HISTORY_MAX) session.history.shift();

      if (REGUA_IMAGE_URL) {
        await sendWhatsAppImage(from, REGUA_IMAGE_URL, "Régua de degustação do Arsenal. Você escolhe 4 estilos, 200ml cada taça.");
      }
      return res.sendStatus(200);
    }

    else if (intent === "PETS") {
      reply = FAQ.pets;
    }

    else if (intent === "SHIPPING") {
      // Envio e online: resposta + Kaique
      reply = `${FAQ.envio}\n\n${buildKaiqueLudico()}`;
    }

    else if (intent === "GLASSES") {
      reply = `${FAQ.copos}\n\n${buildKaiqueLudico()}`;
    }

    else if (intent === "INFLUENCERS") {
      reply = FAQ.influencers; // já inclui contato do Kelvin direto
    }

    else if (intent === "FRANCHISE") {
      reply = FAQ.franquia;
    }

    else if (intent === "CHOPP") {
      reply = buildChoppReply();
    }

    else if (intent === "RESERVAS") {
      reply = `${FAQ.reservas}\n\nSe você curte experimentar vários estilos, a dica é a régua: ${REGUA.text}`;
    }

    else if (intent === "SMARTTAP_ISSUE") {
      reply = buildSmartTapSupportReply();
    }

    // ----------- FALLBACK (GPT com regras duras) -----------
    else {
      reply = await askOpenAI(session, message);
      if (!reply) reply = buildLastResort();
    }

    // Segurança: se o GPT vier “sem certeza” e não tiver site, usa last resort
    if (reply.toLowerCase().includes("não tenho essa informação") || reply.toLowerCase().includes("não posso") || reply.toLowerCase().includes("não consigo")) {
      // tenta manter humano, mas não travar
      reply = buildLastResort();
    }

    // envia resposta
    await sendWhatsAppText(from, reply);

    // salva histórico curto (saída do bot)
    session.history.push({ role: "assistant", content: reply });
    if (session.history.length > HISTORY_MAX) session.history.shift();

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
